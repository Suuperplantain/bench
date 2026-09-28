package store

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/Suuperplantain/bench/internal/discovery"
)

func TestSyncProjectsPreservesNotesAndRefreshesGitMetadata(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "bench.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	ctx := context.Background()
	project := discovery.Project{ID: "project-1", Name: "sample", Path: t.TempDir(), Language: "Go", Branch: "main"}
	if err := database.SyncProjects(ctx, []discovery.Project{project}); err != nil {
		t.Fatal(err)
	}
	if err := database.SaveNote(ctx, project.ID, "Resume the API tests"); err != nil {
		t.Fatal(err)
	}
	project.Branch = "feature/notes"
	project.Dirty = true
	if err := database.SyncProjects(ctx, []discovery.Project{project}); err != nil {
		t.Fatal(err)
	}

	projects, err := database.ListProjects(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(projects) != 1 || projects[0].Branch != "feature/notes" || !projects[0].Dirty {
		t.Fatalf("metadata was not refreshed: %+v", projects)
	}
	if projects[0].Note != "Resume the API tests" {
		t.Fatalf("note was not preserved: %+v", projects[0])
	}
}

func TestSaveNoteRejectsUnknownProject(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "bench.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	err = database.SaveNote(context.Background(), "missing", "note")
	if err != ErrProjectNotFound {
		t.Fatalf("SaveNote() error = %v, want ErrProjectNotFound", err)
	}
}

func TestProjectChatThreadPersistsPerRepository(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "bench.db"))
	if err != nil { t.Fatal(err) }
	defer database.Close()
	ctx := context.Background()
	project := discovery.Project{ID: "project-chat", Name: "sample", Path: t.TempDir(), Language: "Go", Branch: "main"}
	if err := database.SyncProjects(ctx, []discovery.Project{project}); err != nil { t.Fatal(err) }
	threadID, err := database.ChatThreadID(ctx, project.ID)
	if err != nil || threadID != "" { t.Fatalf("initial thread = %q, %v; want empty", threadID, err) }
	if err := database.SaveChatThreadID(ctx, project.ID, "thr_repo_123"); err != nil { t.Fatal(err) }
	threadID, err = database.ChatThreadID(ctx, project.ID)
	if err != nil || threadID != "thr_repo_123" { t.Fatalf("saved thread = %q, %v", threadID, err) }
}
