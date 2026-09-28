package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/Suuperplantain/bench/internal/discovery"
	_ "modernc.org/sqlite"
)

var ErrProjectNotFound = errors.New("project not found")

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	database, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite database: %w", err)
	}
	database.SetMaxOpenConns(1)
	if _, err := database.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		database.Close()
		return nil, fmt.Errorf("enable sqlite foreign keys: %w", err)
	}
	const schema = `
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    language TEXT NOT NULL,
    branch TEXT NOT NULL,
    dirty INTEGER NOT NULL,
    latest_commit TEXT NOT NULL,
    last_commit_at TEXT,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_notes (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    body TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_chat_threads (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL,
    updated_at TEXT NOT NULL
);`
	if _, err := database.Exec(schema); err != nil {
		database.Close()
		return nil, fmt.Errorf("create sqlite schema: %w", err)
	}
	return &Store{db: database}, nil
}

func (store *Store) ChatThreadID(ctx context.Context, projectID string) (string, error) {
	var threadID string
	err := store.db.QueryRowContext(ctx, `SELECT thread_id FROM project_chat_threads WHERE project_id = ?`, projectID).Scan(&threadID)
	if errors.Is(err, sql.ErrNoRows) { return "", nil }
	if err != nil { return "", fmt.Errorf("read project chat thread: %w", err) }
	return threadID, nil
}

func (store *Store) SaveChatThreadID(ctx context.Context, projectID, threadID string) error {
	_, err := store.db.ExecContext(ctx, `INSERT INTO project_chat_threads(project_id, thread_id, updated_at)
VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET thread_id = excluded.thread_id, updated_at = excluded.updated_at`,
		projectID, threadID, time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil { return fmt.Errorf("save project chat thread: %w", err) }
	return nil
}

func (store *Store) Close() error { return store.db.Close() }

func (store *Store) SyncProjects(ctx context.Context, projects []discovery.Project) error {
	transaction, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin project sync: %w", err)
	}
	defer transaction.Rollback()

	statement, err := transaction.PrepareContext(ctx, `
INSERT INTO projects (id, name, path, language, branch, dirty, latest_commit, last_commit_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    path = excluded.path,
    language = excluded.language,
    branch = excluded.branch,
    dirty = excluded.dirty,
    latest_commit = excluded.latest_commit,
    last_commit_at = excluded.last_commit_at,
    updated_at = excluded.updated_at`)
	if err != nil {
		return fmt.Errorf("prepare project sync: %w", err)
	}
	defer statement.Close()

	for _, project := range projects {
		var committedAt any
		if project.LastCommitAt != nil {
			committedAt = project.LastCommitAt.UTC().Format(time.RFC3339Nano)
		}
		dirty := 0
		if project.Dirty {
			dirty = 1
		}
		if _, err := statement.ExecContext(
			ctx,
			project.ID,
			project.Name,
			project.Path,
			project.Language,
			project.Branch,
			dirty,
			project.LatestCommit,
			committedAt,
			time.Now().UTC().Format(time.RFC3339Nano),
		); err != nil {
			return fmt.Errorf("save project %q: %w", project.Name, err)
		}
	}
	if err := transaction.Commit(); err != nil {
		return fmt.Errorf("commit project sync: %w", err)
	}
	return nil
}

func (store *Store) ListProjects(ctx context.Context) ([]discovery.Project, error) {
	rows, err := store.db.QueryContext(ctx, `
SELECT p.id, p.name, p.path, p.language, p.branch, p.dirty, p.latest_commit, p.last_commit_at, COALESCE(n.body, '')
FROM projects p
LEFT JOIN project_notes n ON n.project_id = p.id
ORDER BY lower(p.name), p.path`)
	if err != nil {
		return nil, fmt.Errorf("query projects: %w", err)
	}
	defer rows.Close()

	projects := make([]discovery.Project, 0)
	for rows.Next() {
		var project discovery.Project
		var dirty int
		var committedAt sql.NullString
		if err := rows.Scan(
			&project.ID,
			&project.Name,
			&project.Path,
			&project.Language,
			&project.Branch,
			&dirty,
			&project.LatestCommit,
			&committedAt,
			&project.Note,
		); err != nil {
			return nil, fmt.Errorf("read project row: %w", err)
		}
		project.Dirty = dirty != 0
		if committedAt.Valid {
			parsed, err := time.Parse(time.RFC3339Nano, committedAt.String)
			if err == nil {
				project.LastCommitAt = &parsed
			}
		}
		projects = append(projects, project)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate project rows: %w", err)
	}
	return projects, nil
}

func (store *Store) SaveNote(ctx context.Context, projectID, note string) error {
	transaction, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin note save: %w", err)
	}
	defer transaction.Rollback()

	var exists int
	if err := transaction.QueryRowContext(ctx, `SELECT 1 FROM projects WHERE id = ?`, projectID).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrProjectNotFound
		}
		return fmt.Errorf("check project for note: %w", err)
	}
	_, err = transaction.ExecContext(ctx, `
INSERT INTO project_notes (project_id, body, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(project_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
		projectID,
		note,
		time.Now().UTC().Format(time.RFC3339Nano),
	)
	if err != nil {
		return fmt.Errorf("save project note: %w", err)
	}
	if err := transaction.Commit(); err != nil {
		return fmt.Errorf("commit project note: %w", err)
	}
	return nil
}
