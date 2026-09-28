# Bench

Bench is a local developer dashboard. It discovers Git repositories in folders you choose, records their current status in SQLite, and gives them a home on a small pixel-art project shelf. Click a project to see its Git snapshot or save a local note. The dog is a separate overlay that stays at the right side and changes poses on its own. It stays hungry until you offer a treat; feeding plays the catch-and-chew poses, then the dog settles into its fed routine. Click the dog to give it a pat.

## Run

Install Go, then from this directory:

```powershell
go run ./cmd/bench -root "C:\path\to\projects"
```

Open <http://127.0.0.1:7341> after Bench starts. The Go server serves the frontend from the web directory and the API from /api/; no separate frontend build is needed. Pass `-root` more than once to scan several folders. Bench does one full discovery scan when it starts, then keeps the project list in SQLite. Reloading the shelf only reads that saved list. When you add a project, Bench checks only that path and requires it to be inside one of the configured roots. Bench listens only on `127.0.0.1:7341` by default and stores its database under `.bench/` in the current directory. Use `-listen` or `-db` to change those settings.

## API

- `GET /api/health` — service health
- `GET /api/projects` — saved project list and notes; no filesystem scan
- `POST /api/projects` — inspect and add one Git repository: `{"path":"C:\\path\\to\\repo"}`
- `PUT /api/projects/{id}/note` — save or clear a project note
- `GET /` — local project shelf

Project discovery reads Git metadata using read-only Git commands. It doesn’t change repositories or run their code. The server binds to loopback, and project paths and notes stay in the local SQLite database.

## Checks

```powershell
go test ./...
go vet ./...
```
