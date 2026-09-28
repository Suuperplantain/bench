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
	if err := os.MkdirAll(filepath.Join(repository, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repository, "go.mod"), []byte("module example.test/sample\n"), 0o600); err != nil {
		t.Fatal(err)
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
