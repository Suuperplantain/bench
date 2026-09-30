# Bench

Bench is a local-first project shelf for working with Codex. Most of the time it stays tucked into a small bottom-left launcher. Open it when you want the room, choose a project scroll to continue its repository chat, and keep the dog and his controls in the opposite corner.

## Screenshots

The browser preview opens as a compact launcher over a dark, quiet backdrop. Click **Bench** to unfold the room and show projects grouped by priority, in-progress, and done. Click the dog to open his smaller controls; his artwork stays on the right while the shelf is open.

These screenshots are from the earlier full-page prototype and will be replaced once the floating-window shell is ready. Project names shown in those captures are generic examples.

![Earlier Bench shelf prototype](docs/screenshots/project-shelf.png)

## Current state

The Go server, local SQLite project index, initial discovery scan, and add-one-project flow are in place. Reloading the shelf reads saved records instead of rescanning every repository. The new room preview is a floating panel opened from a small bottom-left Bench launcher. Project scrolls are grouped by status—red for priority, orange for in progress, green for done—and can be searched and reassigned. Opening a scroll brings up a repository-scoped coding chat and a parchment-style side desk. Notes and visible chat history stay in the browser; the chat session identifier and project index stay in the local database.

The room also has a draggable plant and a dog fixed to the right side of the screen. The dog alternates between two sitting poses, raises a paw when a project scroll is hovered, eats through four transparent frames when fed, and only sleeps after inactivity or when asked. A seven-commit treat counter, hunger cycle, and health timer are saved locally. The Desk, Changes, and Files views are currently a layout scaffold; wiring those views to live repository diffs and file browsing is still ahead.

## How it is built

Bench keeps the backend deliberately small. The Go standard library serves the app and its HTTP API. The `internal/discovery` package inspects Git repositories, `internal/store` persists the project index in SQLite, and `internal/api` exposes the local endpoints. The frontend is plain HTML, CSS, and JavaScript served directly by Go; there is no separate frontend build step.

The local-first boundary is intentional: Bench binds to loopback by default, scans configured folders on startup, and only inspects a single requested path when adding a project. Project notes, chat transcripts, and the SQLite index are local data and are not part of this repository. The dog’s vitals live in browser storage. The repository contains the app code, pixel-art assets, and screenshot examples. The browser preview uses a dark fallback behind the transparent room; a native always-on-top Windows shell is a later milestone and this preview does not float above other desktop applications.

## Run

Install Go, then from this directory:

```powershell
go run ./cmd/bench -root "C:\path\to\projects"
```

### Connect repository chat to your Codex account

Each person who runs Bench connects their own Codex CLI login on their own machine. Bench does not contain the repository owner’s credentials, and cloning this repository does not give anyone access to another person’s Codex account. The chat runs locally under the operating-system account that started Bench, using that account’s Codex CLI session.

1. Install the [Codex CLI](https://developers.openai.com/codex/cli/).
2. In a terminal, run `codex login` and complete sign-in to your own Codex account.
3. Run `codex login status` to confirm that the CLI is signed in.
4. Start Bench with `go run ./cmd/bench -root "C:\\path\\to\\projects"`, then open a project scroll and send a message.

Bench starts Codex App Server locally for each chat turn. It uses the signed-in account’s configured Codex model and limits file changes to the selected repository. No API key is required. Sign-in and chat history stay on the machine running Bench; the chat thread identifier is stored in that machine’s local `.bench` database.

Open <http://127.0.0.1:7341> after Bench starts. The Go server serves the frontend from the web directory and the API from /api/; no separate frontend build is needed. Pass `-root` more than once to scan several folders. Bench does one full discovery scan when it starts, then keeps the project list in SQLite. Reloading the shelf only reads that saved list. When you add a project, Bench checks only that path and requires it to be inside one of the configured roots. Bench listens only on `127.0.0.1:7341` by default and stores its database under `.bench/` in the current directory. Use `-listen` or `-db` to change those settings.

## API

- `GET /api/health` — service health
- `GET /api/projects` — saved project list, notes, and current commit counts; no filesystem scan
- `POST /api/projects` — inspect and add one Git repository: `{"path":"C:\\path\\to\\repo"}`
- `PUT /api/projects/{id}/note` — save or clear a project note
- `POST /api/projects/{id}/chat` — stream a Codex response for the selected repository using server-sent events
- `GET /` — local project shelf

Project discovery reads Git metadata using read-only Git commands. It doesn’t change repositories or run their code. The server binds to loopback, and project paths and notes stay in the local SQLite database.

## Checks

```powershell
go test ./...
go vet ./...
```
