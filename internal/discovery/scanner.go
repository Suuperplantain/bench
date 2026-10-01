package discovery

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

var ignoredDirectories = map[string]struct{}{
	".bench": {}, ".cache": {}, ".gradle": {}, ".idea": {},
	".next": {}, ".venv": {}, "build": {}, "dist": {}, "node_modules": {},
	"target": {}, "vendor": {}, "venv": {},
}

// Scanner finds repositories below explicit local roots. It never follows symlinks.
type Scanner struct {
	roots []string
}

func New(roots []string) *Scanner {
	return &Scanner{roots: append([]string(nil), roots...)}
}

func (scanner *Scanner) Scan(ctx context.Context) ([]Project, error) {
	projectsByID := make(map[string]Project)
	for _, root := range scanner.roots {
		info, err := os.Stat(root)
		if err != nil {
			return nil, fmt.Errorf("read scan root %q: %w", root, err)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("scan root %q is not a directory", root)
		}

		err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if path == root {
				return nil
			}
			if entry.Name() == ".git" {
				repositoryPath := filepath.Dir(path)
				project, err := inspectRepository(ctx, repositoryPath)
				if err != nil {
					return err
				}
				projectsByID[project.ID] = project
				if entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if !entry.IsDir() {
				return nil
			}
			if _, skip := ignoredDirectories[entry.Name()]; skip {
				return filepath.SkipDir
			}
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("scan root %q: %w", root, err)
		}
	}

	projects := make([]Project, 0, len(projectsByID))
	for _, project := range projectsByID {
		projects = append(projects, project)
	}
	sortProjects(projects)
	return projects, nil
}

// InspectPath validates and inspects one repository path without walking the configured roots.
func (scanner *Scanner) InspectPath(ctx context.Context, candidate string) (Project, error) {
	absolutePath, err := filepath.Abs(candidate)
	if err != nil {
		return Project{}, fmt.Errorf("resolve project path %q: %w", candidate, err)
	}
	absPath := filepath.Clean(absolutePath)
	info, err := os.Stat(absPath)
	if err != nil || !info.IsDir() {
		return Project{}, fmt.Errorf("project path must be an existing directory")
	}
	// Lexical containment is insufficient here: a symlink or Windows junction
	// inside a configured root could point at private directories outside it.
	absPath, err = filepath.EvalSymlinks(absPath)
	if err != nil { return Project{}, fmt.Errorf("resolve project directory: %w", err) }
	absPath = filepath.Clean(absPath)

	allowed := false
	for _, root := range scanner.roots {
		absoluteRoot, err := filepath.Abs(root)
		if err != nil {
			continue
		}
		resolvedRoot, err := filepath.EvalSymlinks(absoluteRoot)
		if err == nil && isWithinRoot(filepath.Clean(resolvedRoot), absPath) {
			allowed = true
			break
		}
	}
	if !allowed {
		return Project{}, fmt.Errorf("project path must be inside a configured scan root")
	}

	repositoryRoot := gitOutput(ctx, absPath, "rev-parse", "--show-toplevel")
	if repositoryRoot == "" {
		return Project{}, fmt.Errorf("path is not a Git repository")
	}
	if !filepath.IsAbs(repositoryRoot) {
		repositoryRoot = filepath.Join(absPath, repositoryRoot)
	}
	repositoryRoot, err = filepath.Abs(repositoryRoot)
	if err != nil {
		return Project{}, fmt.Errorf("resolve Git repository root: %w", err)
	}
	repositoryRoot = filepath.Clean(repositoryRoot)
	if !samePath(repositoryRoot, absPath) {
		return Project{}, fmt.Errorf("choose the repository root, not a folder inside it")
	}
	insideAllowedRoot := false
	for _, root := range scanner.roots {
		absoluteRoot, err := filepath.Abs(root)
		if err != nil { continue }
		resolvedRoot, err := filepath.EvalSymlinks(absoluteRoot)
		if err == nil && isWithinRoot(filepath.Clean(resolvedRoot), repositoryRoot) {
			insideAllowedRoot = true
			break
		}
	}
	if !insideAllowedRoot {
		return Project{}, fmt.Errorf("Git repository root must be inside a configured scan root")
	}
	return inspectRepository(ctx, absPath)
}

func samePath(left, right string) bool {
	if runtime.GOOS == "windows" {
		return strings.EqualFold(filepath.Clean(left), filepath.Clean(right))
	}
	return filepath.Clean(left) == filepath.Clean(right)
}

func isWithinRoot(root, candidate string) bool {
	relative, err := filepath.Rel(root, candidate)
	if err != nil {
		return false
	}
	return relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)))
}

func inspectRepository(parent context.Context, repositoryPath string) (Project, error) {
	absolutePath, err := filepath.Abs(repositoryPath)
	if err != nil {
		return Project{}, fmt.Errorf("resolve repository path %q: %w", repositoryPath, err)
	}
	absolutePath = filepath.Clean(absolutePath)
	identity := strings.ToLower(absolutePath)
	hash := sha256.Sum256([]byte(identity))

	project := Project{
		ID:       hex.EncodeToString(hash[:12]),
		Name:     filepath.Base(absolutePath),
		Path:     absolutePath,
		Language: detectLanguage(absolutePath),
	}

	branch := gitOutput(parent, absolutePath, "branch", "--show-current")
	project.Branch = branch
	project.Dirty = gitOutput(parent, absolutePath, "status", "--porcelain") != ""
	project.LatestCommit = gitOutput(parent, absolutePath, "log", "-1", "--format=%s")
	if timestamp := gitOutput(parent, absolutePath, "log", "-1", "--format=%cI"); timestamp != "" {
		parsed, parseErr := time.Parse(time.RFC3339, timestamp)
		if parseErr == nil {
			project.LastCommitAt = &parsed
		}
	}
	return project, nil
}

func gitOutput(parent context.Context, repositoryPath string, args ...string) string {
	ctx, cancel := context.WithTimeout(parent, 2*time.Second)
	defer cancel()
	commandArgs := append([]string{"-c", "core.fsmonitor=false", "-C", repositoryPath}, args...)
	output, err := exec.CommandContext(ctx, "git", commandArgs...).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

func detectLanguage(root string) string {
	markers := []struct {
		files    []string
		language string
	}{
		{[]string{"go.mod"}, "Go"},
		{[]string{"Cargo.toml"}, "Rust"},
		{[]string{"pom.xml", "build.gradle", "build.gradle.kts"}, "Java"},
		{[]string{"package.json", "tsconfig.json"}, "JavaScript / TypeScript"},
		{[]string{"pyproject.toml", "requirements.txt", "Pipfile"}, "Python"},
		{[]string{"Gemfile"}, "Ruby"},
		{[]string{"CMakeLists.txt", "*.sln", "*.vcxproj"}, "C++"},
	}
	for _, marker := range markers {
		for _, filename := range marker.files {
			if strings.ContainsAny(filename, "*?[") {
				matches, _ := filepath.Glob(filepath.Join(root, filename))
				if len(matches) > 0 {
					return marker.language
				}
				continue
			}
			if _, err := os.Stat(filepath.Join(root, filename)); err == nil {
				return marker.language
			}
		}
	}
	return "Unknown"
}

func sortProjects(projects []Project) {
	sort.Slice(projects, func(i, j int) bool {
		return strings.ToLower(projects[i].Name) < strings.ToLower(projects[j].Name)
	})
}
