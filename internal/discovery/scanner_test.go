package discovery

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestScanFindsGitRepositoriesAndSkipsGeneratedFolders(t *testing.T) {
	root := t.TempDir()
	repository := filepath.Join(root, "sample-go")
	if err := os.MkdirAll(filepath.Join(repository, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repository, "go.mod"), []byte("module example.test/sample\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	ignoredRepository := filepath.Join(root, "node_modules", "nested")
	if err := os.MkdirAll(filepath.Join(ignoredRepository, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}

	projects, err := New([]string{root}).Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan() error = %v", err)
	}
	if len(projects) != 1 {
		t.Fatalf("Scan() found %d projects, want 1", len(projects))
	}
	if projects[0].Name != "sample-go" || projects[0].Language != "Go" {
		t.Fatalf("unexpected project: %+v", projects[0])
	}
	if projects[0].ID == "" || projects[0].Path != repository {
		t.Fatalf("project identity or path missing: %+v", projects[0])
	}
}

func TestScanRejectsInvalidRoot(t *testing.T) {
	_, err := New([]string{filepath.Join(t.TempDir(), "missing")}).Scan(context.Background())
	if err == nil {
		t.Fatal("Scan() error = nil, want an error for a missing root")
	}
}
