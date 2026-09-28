package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
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

	database, err := store.Open(filepath.Join(t.TempDir(), "bench.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	server := httptest.NewServer(NewHandler(discovery.New([]string{root}), database))
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
	if projects[0].Note != "Finish the scan tests" {
		t.Fatalf("saved note = %q", projects[0].Note)
	}
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
