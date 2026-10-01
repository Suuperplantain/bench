package api

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Suuperplantain/bench/internal/codex"
	"github.com/Suuperplantain/bench/internal/discovery"
	"github.com/Suuperplantain/bench/internal/store"
)

type ProjectScanner interface {
	InspectPath(context.Context, string) (discovery.Project, error)
}

type ProjectStore interface {
	SyncProjects(context.Context, []discovery.Project) error
	ListProjects(context.Context) ([]discovery.Project, error)
	SaveNote(context.Context, string, string) error
	ChatThreadID(context.Context, string) (string, error)
	SaveChatThreadID(context.Context, string, string) error
}

type Handler struct {
	scanner ProjectScanner
	store   ProjectStore
	codex   *codex.AppServer
	chatLocksMu sync.Mutex
	chatLocks map[string]*sync.Mutex
	approvalsMu sync.Mutex
	approvals map[string]chan bool
}

func NewHandler(scanner ProjectScanner, projectStore ProjectStore) http.Handler {
	handler := &Handler{scanner: scanner, store: projectStore, codex: codex.New(), chatLocks: make(map[string]*sync.Mutex), approvals: make(map[string]chan bool)}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", handler.health)
	mux.HandleFunc("GET /api/projects", handler.projects)
	mux.HandleFunc("POST /api/projects", handler.addProject)
	mux.HandleFunc("PUT /api/projects/{id}/note", handler.saveNote)
	mux.HandleFunc("POST /api/projects/{id}/chat", handler.chat)
	mux.HandleFunc("POST /api/approvals/{id}", handler.decideApproval)
	mux.Handle("/", staticFiles())
	return securityHeaders(mux)
}

func (handler *Handler) chat(w http.ResponseWriter, r *http.Request) {
	projectID := strings.TrimSpace(r.PathValue("id"))
	if projectID == "" { writeError(w, http.StatusBadRequest, "project ID is required"); return }
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var payload struct { Message string `json:"message"` }
	if err := decoder.Decode(&payload); err != nil { writeError(w, http.StatusBadRequest, "request must contain a chat message"); return }
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) { writeError(w, http.StatusBadRequest, "request must contain one JSON object"); return }
	payload.Message = strings.TrimSpace(payload.Message)
	if payload.Message == "" { writeError(w, http.StatusBadRequest, "write a message first"); return }
	if len([]rune(payload.Message)) > 8000 { writeError(w, http.StatusBadRequest, "message must be 8000 characters or fewer"); return }
	projects, err := handler.store.ListProjects(r.Context())
	if err != nil { writeError(w, http.StatusInternalServerError, "project metadata could not be read"); return }
	var project *discovery.Project
	for i := range projects { if projects[i].ID == projectID { project = &projects[i]; break } }
	if project == nil { writeError(w, http.StatusNotFound, "project was not found; refresh the shelf"); return }
	chatLock := handler.chatLock(projectID)
	chatLock.Lock()
	defer chatLock.Unlock()
	threadID, err := handler.store.ChatThreadID(r.Context(), projectID)
	if err != nil { writeError(w, http.StatusInternalServerError, "project chat could not be loaded"); return }
	if _, err := os.Stat(project.Path); err != nil { writeError(w, http.StatusConflict, "the repository folder is no longer available"); return }
	if _, err := handler.scanner.InspectPath(r.Context(), project.Path); err != nil { writeError(w, http.StatusConflict, "this folder is no longer a valid repository in Bench"); return }
	flusher, ok := w.(http.Flusher)
	if !ok { writeError(w, http.StatusInternalServerError, "streaming is not available"); return }
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()
	emit := func(event codex.Event) {
		if event.Type == "thread" { if saveErr := handler.store.SaveChatThreadID(r.Context(), projectID, event.ThreadID); saveErr != nil { event = codex.Event{Type: "error", Text: "Could not save this chat thread: " + saveErr.Error()} } }
		data, marshalErr := json.Marshal(event)
		if marshalErr == nil { _, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, data); flusher.Flush() }
	}
	prompt := "This chat is attached to the repository '" + project.Name + "'. Keep your answers and any code changes focused on this repository.\n\n" + payload.Message
	_, err = handler.codex.RunTurn(r.Context(), project.Path, threadID, prompt, emit, func(ctx context.Context, request codex.ApprovalRequest) bool {
		var token [24]byte
		if _, err := rand.Read(token[:]); err != nil { return false }
		request.ID = fmt.Sprintf("%x", token)
		decision := make(chan bool, 1)
		handler.approvalsMu.Lock()
		handler.approvals[request.ID] = decision
		handler.approvalsMu.Unlock()
		defer func() { handler.approvalsMu.Lock(); delete(handler.approvals, request.ID); handler.approvalsMu.Unlock() }()
		emit(codex.Event{Type: "approval", Approval: &request})
		select {
		case accepted := <-decision: return accepted
		case <-ctx.Done(): return false
		case <-time.After(5 * time.Minute): return false
		}
	})
	if err != nil { emit(codex.Event{Type: "error", Text: err.Error()}) }
}

func (handler *Handler) decideApproval(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var payload struct { Decision string `json:"decision"` }
	if err := decoder.Decode(&payload); err != nil { writeError(w, http.StatusBadRequest, "expected an approval decision"); return }
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) { writeError(w, http.StatusBadRequest, "expected one JSON object"); return }
	if payload.Decision != "accept" && payload.Decision != "decline" { writeError(w, http.StatusBadRequest, "decision must be accept or decline"); return }
	handler.approvalsMu.Lock()
	decision := handler.approvals[r.PathValue("id")]
	if decision == nil { handler.approvalsMu.Unlock(); writeError(w, http.StatusNotFound, "approval request is no longer active"); return }
	select {
	case decision <- payload.Decision == "accept":
		delete(handler.approvals, r.PathValue("id"))
		handler.approvalsMu.Unlock()
		writeJSON(w, http.StatusOK, map[string]string{"status": "recorded"})
	default:
		handler.approvalsMu.Unlock()
		writeError(w, http.StatusConflict, "approval already answered")
	}
}

func (handler *Handler) chatLock(projectID string) *sync.Mutex {
	handler.chatLocksMu.Lock()
	defer handler.chatLocksMu.Unlock()
	if handler.chatLocks[projectID] == nil { handler.chatLocks[projectID] = &sync.Mutex{} }
	return handler.chatLocks[projectID]
}

func trustedRequest(r *http.Request) bool {
	// Reject DNS rebinding: a browser must address Bench by an actual loopback
	// name or address, not an attacker-controlled hostname resolving to it.
	requestHost := r.Host
	if host, _, err := net.SplitHostPort(r.Host); err == nil { requestHost = host }
	if !loopbackHost(requestHost) { return false }
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" { return false }
	origin := r.Header.Get("Origin")
	if origin == "" { return true }
	parsed, err := url.Parse(origin)
	return err == nil && parsed.Scheme == "http" && parsed.User == nil && parsed.Path == "" && parsed.RawQuery == "" && parsed.Fragment == "" && strings.EqualFold(parsed.Host, r.Host)
}

func loopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") { return true }
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

// staticFiles serves the small local web UI from ./web. API routes remain
// registered above it, and an absent frontend keeps API-only use possible.
func staticFiles() http.Handler {
	files := http.FileServer(http.Dir("web"))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		// Serve only the current UI. A private file accidentally copied into the
		// web directory must never become an HTTP endpoint or directory listing.
		switch r.URL.Path {
		case "/", "/index.html", "/orb-preview.css", "/orb-preview.js", "/assets/void-active.gif", "/vendor/genie-web/index.js", "/vendor/genie-web/chunk-5FUC6FK5.js", "/vendor/html2canvas.min.js":
		default:
			http.NotFound(w, r)
			return
		}
		if _, err := os.Stat("web/index.html"); err != nil {
			http.NotFound(w, r)
			return
		}
		files.ServeHTTP(w, r)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
		w.Header().Set("Cache-Control", "no-store")
		if !trustedRequest(r) {
			writeError(w, http.StatusForbidden, "Bench is only available from its own loopback page")
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") && r.Method != http.MethodGet && r.Method != http.MethodHead {
			mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if err != nil || mediaType != "application/json" {
				writeError(w, http.StatusUnsupportedMediaType, "API changes require application/json")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (handler *Handler) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "bench"})
}

func (handler *Handler) projects(w http.ResponseWriter, r *http.Request) {
	projects, err := handler.store.ListProjects(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "project metadata could not be read")
		return
	}
	type projectSummary struct {
		ID string `json:"id"`
		Name string `json:"name"`
		Branch string `json:"branch"`
		CommitCount int `json:"commit_count"`
	}
	summaries := make([]projectSummary, 0, len(projects))
	for i := range projects {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		output, countErr := exec.CommandContext(ctx, "git", "-c", "core.fsmonitor=false", "-C", projects[i].Path, "rev-list", "--count", "HEAD").Output()
		cancel()
		if countErr == nil {
			projects[i].CommitCount, _ = strconv.Atoi(strings.TrimSpace(string(output)))
		}
		summaries = append(summaries, projectSummary{ID: projects[i].ID, Name: projects[i].Name, Branch: projects[i].Branch, CommitCount: projects[i].CommitCount})
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": summaries, "chat_enabled": true})
}

func (handler *Handler) addProject(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var payload struct {
		Path string `json:"path"`
	}
	if err := decoder.Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "request must contain a project path")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "request must contain one JSON object")
		return
	}
	payload.Path = strings.TrimSpace(payload.Path)
	if payload.Path == "" {
		writeError(w, http.StatusBadRequest, "project path is required")
		return
	}
	project, err := handler.scanner.InspectPath(r.Context(), payload.Path)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := handler.store.SyncProjects(r.Context(), []discovery.Project{project}); err != nil {
		writeError(w, http.StatusInternalServerError, "project metadata could not be saved")
		return
	}
	projects, err := handler.store.ListProjects(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "project metadata could not be read")
		return
	}
	for _, saved := range projects {
		if saved.ID == project.ID {
			writeJSON(w, http.StatusOK, saved)
			return
		}
	}
	writeError(w, http.StatusInternalServerError, "project could not be loaded after saving")
}

func (handler *Handler) saveNote(w http.ResponseWriter, r *http.Request) {
	projectID := strings.TrimSpace(r.PathValue("id"))
	if projectID == "" {
		writeError(w, http.StatusBadRequest, "project ID is required")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var payload struct {
		Note string `json:"note"`
	}
	if err := decoder.Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "request must contain a JSON note")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "request must contain one JSON object")
		return
	}
	payload.Note = strings.TrimSpace(payload.Note)
	if len([]rune(payload.Note)) > 2000 {
		writeError(w, http.StatusBadRequest, "note must be 2000 characters or fewer")
		return
	}

	if err := handler.store.SaveNote(r.Context(), projectID, payload.Note); err != nil {
		if errors.Is(err, store.ErrProjectNotFound) {
			writeError(w, http.StatusNotFound, "project was not found; refresh the project list")
			return
		}
		writeError(w, http.StatusInternalServerError, "project note could not be saved")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": projectID, "note": payload.Note})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		fmt.Printf("encode HTTP response: %v\n", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
