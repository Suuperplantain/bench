package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Suuperplantain/bench/internal/discovery"
	"github.com/Suuperplantain/bench/internal/store"
)

func TestProjectsAndNotesFlow(t *testing.T) {
	root := t.TempDir()
	repository := filepath.Join(root, "sample")
	if err := os.MkdirAll(repository, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repository, "go.mod"), []byte("module example.test/sample\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command("git", "-C", repository, "init", "-q").CombinedOutput(); err != nil {
		t.Fatalf("initialize sample repository: %v: %s", err, output)
	}
	for _, setting := range [][]string{{"user.name", "Bench Test"}, {"user.email", "bench-test@example.invalid"}} {
		if output, err := exec.Command("git", "-C", repository, "config", setting[0], setting[1]).CombinedOutput(); err != nil {
			t.Fatalf("configure sample repository: %v: %s", err, output)
		}
	}
	for index, content := range []string{"first", "second"} {
		if err := os.WriteFile(filepath.Join(repository, "sample.txt"), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		if output, err := exec.Command("git", "-C", repository, "add", ".").CombinedOutput(); err != nil {
			t.Fatalf("stage sample commit %d: %v: %s", index+1, err, output)
		}
		if output, err := exec.Command("git", "-C", repository, "commit", "-qm", "sample change").CombinedOutput(); err != nil {
			t.Fatalf("create sample commit %d: %v: %s", index+1, err, output)
		}
	}

	scanner := discovery.New([]string{root})
	initialProjects, err := scanner.Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	database, err := store.Open(filepath.Join(t.TempDir(), "bench.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := database.SyncProjects(context.Background(), initialProjects); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewHandler(scanner, database))
	defer server.Close()

	response, err := http.Get(server.URL + "/api/projects")
	if err != nil {
		t.Fatal(err)
	}
	var projectsResponse struct {
		Projects []discovery.Project `json:"projects"`
	}
	if err := json.NewDecoder(response.Body).Decode(&projectsResponse); err != nil {
		response.Body.Close()
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK || len(projectsResponse.Projects) != 1 {
		t.Fatalf("GET /api/projects status=%d projects=%+v", response.StatusCode, projectsResponse.Projects)
	}
	if projectsResponse.Projects[0].CommitCount != 2 {
		t.Fatalf("GET /api/projects commit count = %d, want 2", projectsResponse.Projects[0].CommitCount)
	}
	if projectsResponse.Projects[0].Path != "" {
		t.Fatal("GET /api/projects exposed an absolute local path")
	}

	projectID := projectsResponse.Projects[0].ID
	newRepository := filepath.Join(root, "new-project")
	if err := os.MkdirAll(newRepository, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(newRepository, "go.mod"), []byte("module example.test/new-project\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command("git", "-C", newRepository, "init", "-q").CombinedOutput(); err != nil {
		t.Fatalf("initialize test repository: %v: %s", err, output)
	}
	addPayload, err := json.Marshal(map[string]string{"path": newRepository})
	if err != nil {
		t.Fatal(err)
	}
	addRequest, err := http.NewRequest(http.MethodPost, server.URL+"/api/projects", strings.NewReader(string(addPayload)))
	if err != nil {
		t.Fatal(err)
	}
	addRequest.Header.Set("Content-Type", "application/json")
	response, err = http.DefaultClient.Do(addRequest)
	if err != nil {
		t.Fatal(err)
	}
	addResponse, readErr := io.ReadAll(response.Body)
	response.Body.Close()
	if readErr != nil {
		t.Fatal(readErr)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("POST project status = %d, want %d: %s", response.StatusCode, http.StatusOK, addResponse)
	}

	request, err := http.NewRequest(http.MethodPut, server.URL+"/api/projects/"+projectID+"/note", strings.NewReader(`{"note":"Finish the scan tests"}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("PUT note status = %d, want %d", response.StatusCode, http.StatusOK)
	}
	response, err = http.Get(server.URL + "/api/projects")
	if err != nil { t.Fatal(err) }
	var afterNote struct { Projects []discovery.Project `json:"projects"` }
	decodeErr := json.NewDecoder(response.Body).Decode(&afterNote)
	response.Body.Close()
	if decodeErr != nil { t.Fatal(decodeErr) }
	for _, listed := range afterNote.Projects {
		if listed.Path != "" || listed.Note != "" { t.Fatal("repository list exposed a local path or private note") }
	}

	projects, err := database.ListProjects(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(projects) != 2 {
		t.Fatalf("saved project count = %d, want 2", len(projects))
	}
	for _, saved := range projects {
		if saved.ID == projectID {
			if saved.Note != "Finish the scan tests" {
				t.Fatalf("saved note = %q", saved.Note)
			}
			return
		}
	}
	t.Fatalf("original project %q missing after adding another project", projectID)
}

func TestNoteRequestValidation(t *testing.T) {
	database, err := store.Open(filepath.Join(t.TempDir(), "bench.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	server := httptest.NewServer(NewHandler(discovery.New(nil), database))
	defer server.Close()

	request, err := http.NewRequest(http.MethodPut, server.URL+"/api/projects/any/note", strings.NewReader(`{"note":"x","unexpected":true}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid request status = %d, want %d", response.StatusCode, http.StatusBadRequest)
	}
}

func TestChatRejectsForeignOriginsAndUnknownProjects(t *testing.T) {
	database, err := store.Open(filepath.Join(t.TempDir(), "bench.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	server := httptest.NewServer(NewHandler(discovery.New(nil), database))
	defer server.Close()

	request, err := http.NewRequest(http.MethodPost, server.URL+"/api/projects/missing/chat", strings.NewReader(`{"message":"change a file"}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://example.com")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign Origin status = %d, want %d", response.StatusCode, http.StatusForbidden)
	}

	request, err = http.NewRequest(http.MethodPost, server.URL+"/api/projects/missing/chat", strings.NewReader(`{"message":"change a file"}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown project status = %d, want %d", response.StatusCode, http.StatusNotFound)
	}
}

func TestApprovalRequiresAValidPendingRequest(t *testing.T) {
	database, err := store.Open(filepath.Join(t.TempDir(), "bench.db"))
	if err != nil { t.Fatal(err) }
	defer database.Close()
	server := httptest.NewServer(NewHandler(discovery.New(nil), database))
	defer server.Close()

	for _, test := range []struct { body string; want int }{
		{`{"decision":"accept"}`, http.StatusNotFound},
		{`{"decision":"acceptForSession"}`, http.StatusBadRequest},
		{`{"decision":"accept","other":true}`, http.StatusBadRequest},
	} {
		request, err := http.NewRequest(http.MethodPost, server.URL+"/api/approvals/missing", strings.NewReader(test.body))
		if err != nil { t.Fatal(err) }
		request.Header.Set("Content-Type", "application/json")
		response, err := http.DefaultClient.Do(request)
		if err != nil { t.Fatal(err) }
		response.Body.Close()
		if response.StatusCode != test.want { t.Fatalf("approval %s status = %d, want %d", test.body, response.StatusCode, test.want) }
	}
}

func TestLocalAPIRejectsRebindingAndCrossSiteRequests(t *testing.T) {
	database, err := store.Open(filepath.Join(t.TempDir(), "bench.db"))
	if err != nil { t.Fatal(err) }
	defer database.Close()
	server := httptest.NewServer(NewHandler(discovery.New(nil), database))
	defer server.Close()

	tests := []struct {
		name, method, path, host, origin, fetchSite, contentType string
		want int
	}{
		{"normal API", http.MethodGet, "/api/projects", "", "", "", "", http.StatusOK},
		{"rebound host", http.MethodGet, "/api/projects", "attacker.example:7341", "", "", "", http.StatusForbidden},
		{"cross-site read", http.MethodGet, "/api/projects", "", "https://attacker.example", "", "", http.StatusForbidden},
		{"other loopback port", http.MethodGet, "/api/projects", "", "http://127.0.0.1:9999", "", "", http.StatusForbidden},
		{"cross-site fetch", http.MethodGet, "/api/projects", "", "", "cross-site", "", http.StatusForbidden},
		{"non-JSON mutation", http.MethodPost, "/api/projects", "", "", "", "text/plain", http.StatusUnsupportedMediaType},
		{"legacy script unavailable", http.MethodGet, "/app.js", "", "", "", "", http.StatusNotFound},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request, err := http.NewRequest(test.method, server.URL+test.path, nil)
			if err != nil { t.Fatal(err) }
			if test.host != "" { request.Host = test.host }
			if test.origin != "" { request.Header.Set("Origin", test.origin) }
			if test.fetchSite != "" { request.Header.Set("Sec-Fetch-Site", test.fetchSite) }
			if test.contentType != "" { request.Header.Set("Content-Type", test.contentType) }
			response, err := http.DefaultClient.Do(request)
			if err != nil { t.Fatal(err) }
			response.Body.Close()
			if response.StatusCode != test.want { t.Fatalf("status = %d, want %d", response.StatusCode, test.want) }
		})
	}
}
