package discovery

import "time"

// Project is a local snapshot of a Git repository found under a configured root.
type Project struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	Path         string     `json:"path"`
	Language     string     `json:"language"`
	Branch       string     `json:"branch"`
	Dirty        bool       `json:"dirty"`
	CommitCount  int        `json:"commit_count"`
	LatestCommit string     `json:"latest_commit,omitempty"`
	LastCommitAt *time.Time `json:"last_commit_at,omitempty"`
	Note         string     `json:"note"`
}
