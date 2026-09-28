# Bench

Bench is a local developer dashboard. It discovers Git repositories in folders you choose, records their current status in SQLite, and gives them a home on a small pixel-art project shelf. Each project is displayed as a scroll. Open one to see its Git snapshot, set its shelf status (red for priority, orange for in progress, green for done), save a local note, or open a Codex chat scoped to that repository. The chat sits beside the project details and keeps one conversation per repository. Codex can read and edit files in the selected repository; its workspace-write sandbox is restricted to that project folder, and its configured network access supports Git remote work. Shelf statuses and the visible chat transcript are kept in this browser, while the Codex thread ID is stored in Bench’s local SQLite database. A plant decorates the lowest shelf. The dog stays at the right side, alternating between sitting poses every half second. It raises a paw while you hover a project scroll and sleeps after ten minutes without activity. Offering it a treat still plays its catch-and-chew poses.

## Run

Install Go, then from this directory:

```powershell
go run ./cmd/bench -root "C:\path\to\projects"
```

To use the repository chat, install Codex CLI and sign in once with `codex login`. Bench starts Codex App Server locally for each chat turn and uses that existing Codex login; Bench does not need an OpenAI API key. The chat uses the account’s configured Codex model and limits file changes to the selected repository.

Open <http://127.0.0.1:7341> after Bench starts. The Go server serves the frontend from the web directory and the API from /api/; no separate frontend build is needed. Pass `-root` more than once to scan several folders. Bench does one full discovery scan when it starts, then keeps the project list in SQLite. Reloading the shelf only reads that saved list. When you add a project, Bench checks only that path and requires it to be inside one of the configured roots. Bench listens only on `127.0.0.1:7341` by default and stores its database under `.bench/` in the current directory. Use `-listen` or `-db` to change those settings.

## Remove a white image background

On Windows, the PowerShell helper makes near-white pixels connected to an image edge transparent and writes a new PNG, keeping the original intact:

```powershell
.\tools\remove-white-background.ps1 -InputPath "C:\images\sprite.jpg" -OutputPath "C:\images\sprite-cutout.png" -Tolerance 65
```

Raise `-Tolerance` to remove a less pure white backdrop; lower it to preserve pale details.

## API

- `GET /api/health` — service health
- `GET /api/projects` — saved project list and notes; no filesystem scan
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
