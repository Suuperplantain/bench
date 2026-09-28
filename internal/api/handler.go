package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/Suuperplantain/bench/internal/discovery"
	"github.com/Suuperplantain/bench/internal/store"
)

type ProjectScanner interface {
	Scan(context.Context) ([]discovery.Project, error)
}

type ProjectStore interface {
	SyncProjects(context.Context, []discovery.Project) error
	ListProjects(context.Context) ([]discovery.Project, error)
	SaveNote(context.Context, string, string) error
}

type Handler struct {
	scanner ProjectScanner
	store   ProjectStore
}

func NewHandler(scanner ProjectScanner, projectStore ProjectStore) http.Handler {
	handler := &Handler{scanner: scanner, store: projectStore}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", handler.health)
	mux.HandleFunc("GET /api/projects", handler.projects)
	mux.HandleFunc("PUT /api/projects/{id}/note", handler.saveNote)
	mux.HandleFunc("/", handler.notFound)
	return securityHeaders(mux)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func (handler *Handler) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "bench"})
}

func (handler *Handler) projects(w http.ResponseWriter, r *http.Request) {
	projects, err := handler.scanner.Scan(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "project discovery failed")
		return
	}
	if err := handler.store.SyncProjects(r.Context(), projects); err != nil {
		writeError(w, http.StatusInternalServerError, "project metadata could not be saved")
		return
	}
	savedProjects, err := handler.store.ListProjects(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "project metadata could not be read")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": savedProjects})
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

func (handler *Handler) notFound(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeError(w, http.StatusNotFound, "route not found")
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
