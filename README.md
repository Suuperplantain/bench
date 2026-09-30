# Bench

Bench is a local-first workspace for Git repositories and Codex. Its current browser preview starts as a small black orb on the right side of the screen. Click it to open a compact repository workspace.

## Home orb

![Bench home orb](docs/screenshots/home-orb.png)

The two eyes track the cursor and blink together at irregular intervals. Moving the cursor onto the orb makes it nod twice. The white corona shifts around its edge without a fixed video loop.

## Current state

The Go server, SQLite project index, initial repository scan, and add-one-project API are in place. Opening the orb reveals a repository list on the left, with smaller orbs peeking from behind each card, and a conversation area on the right. The list reads real local repositories from the API. The chat streams from the user's local Codex installation; visible messages are saved in browser storage and repository chat thread IDs are saved in SQLite.

This is still a browser preview. It is not yet an always-on-top desktop orb, and the expanded workspace is still being designed. The earlier pixel-room and dog assets remain in the repository but are not part of the current frontend.

## How it is built

Bench keeps the backend deliberately small. The Go standard library serves the app and its HTTP API. The `internal/discovery` package inspects Git repositories, `internal/store` persists the project index in SQLite, and `internal/api` exposes the local endpoints. The frontend is plain HTML, CSS, and JavaScript served directly by Go; there is no separate frontend build step.

The local-first boundary is intentional: Bench binds to loopback by default, scans configured folders on startup, and only inspects a single requested path when adding a project. Project notes, chat transcripts, and the SQLite index stay on the machine running Bench and are not part of this repository. A native always-on-top Windows shell is a later milestone.

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
4. Start Bench with `go run ./cmd/bench -root "C:\\path\\to\\projects"`, then open the orb, select a repository, and send a message.

Bench starts Codex App Server locally for each chat turn. It uses the signed-in account’s configured Codex model and limits file changes to the selected repository. No API key is required. Sign-in and chat history stay on the machine running Bench; the chat thread identifier is stored in that machine’s local `.bench` database.

Open <http://127.0.0.1:7341> after Bench starts. The Go server serves the frontend from the web directory and the API from /api/; no separate frontend build is needed. Pass `-root` more than once to scan several folders. Bench does one full discovery scan when it starts, then keeps the project list in SQLite. Refreshing the repository list only reads those saved records. When you add a project, Bench checks only that path and requires it to be inside one of the configured roots. Bench listens only on `127.0.0.1:7341` by default and stores its database under `.bench/` in the current directory. Use `-listen` or `-db` to change those settings.

## API

- `GET /api/health` — service health
- `GET /api/projects` — saved project list, notes, and current commit counts; no filesystem scan
- `POST /api/projects` — inspect and add one Git repository: `{"path":"C:\\path\\to\\repo"}`
- `PUT /api/projects/{id}/note` — save or clear a project note
- `POST /api/projects/{id}/chat` — stream a Codex response for the selected repository using server-sent events
- `GET /` — local orb preview

Project discovery reads Git metadata using read-only Git commands. It doesn’t change repositories or run their code. The server binds to loopback, and project paths and notes stay in the local SQLite database.

## Checks

```powershell
go test ./...
go vet ./...
```
