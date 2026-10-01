# Bench

Bench is a local-first workspace for Git repositories and Codex. Its current browser preview starts as a small black orb on the right side of the screen. Click it to open a compact repository workspace.

## Home orb

![Bench home orb](docs/screenshots/home-orb.png)

The two eyes track the cursor and blink together at irregular intervals. Moving the cursor onto the orb makes it nod twice. The white corona shifts around its edge without a fixed video loop.

## Current state

The Go server, SQLite project index, initial repository scan, and add-one-project API are in place. Opening the orb reveals a repository list on the left, with smaller orbs peeking from behind each card, and a conversation area on the right. The list reads real local repositories from the API. Repository chat streams through the local Codex installation; visible messages are saved in browser storage and repository chat thread IDs are saved in SQLite.

This is still a browser preview. The desktop orb and expanded workspace are still being built.

## How it is built

Bench keeps the backend deliberately small. The Go standard library serves the app and its HTTP API. The `internal/discovery` package inspects Git repositories, `internal/store` persists the project index in SQLite, and `internal/api` exposes the local endpoints. The frontend is plain HTML, CSS, and JavaScript served directly by Go; there is no separate frontend build step.

The local-first boundary is intentional: Bench binds to loopback, scans configured folders on startup, and only inspects a single requested path when adding a project. Project notes, browser chat transcripts, and the SQLite index stay on the machine running Bench and are not part of this repository. A native always-on-top Windows shell is a later milestone.

## Run

Install Go, then from this directory:

```powershell
go run ./cmd/bench -root "C:\path\to\projects"
```

### Connect repository chat to your Codex account

Bench contains no account credentials. Cloning this repository does not provide access to the original author's computer or Codex account. Repository chat uses the local operating-system account and that person's Codex CLI session.

1. Install a recent [Codex CLI](https://developers.openai.com/codex/cli/) with permission-profile support.
2. In a terminal, run `codex login` and complete sign-in to your own Codex account.
3. Run `codex login status` to confirm that the CLI is signed in.
4. On Windows, complete Codex's **Agent sandbox** setup in the Codex app. Bench requires the stronger `elevated` Windows sandbox for its repo-only read policy and will show an error instead of falling back to broader file access when that setup is unavailable.
5. Start Bench with `go run ./cmd/bench -root "C:\path\to\projects"`, then open the orb, select a repository, and send a message.

Bench starts Codex App Server locally for each turn using the signed-in account's configured model. It selects a temporary `bench_repo` permission profile for that process: the chosen repository is writable, other local files are denied except Codex's minimal tool paths, and command network access starts off. Bench also disables Codex apps, plugins, MCP servers and web search for these turns, so a repository chat does not inherit account-connected tools. On Windows, this restricted-read profile requires the `elevated` sandbox; chat fails closed if it cannot start. If Codex requests a command, file change, network destination or extra filesystem permission that needs approval, Bench shows the request in chat. You can allow a single request or a turn-scoped permission, or decline it; Bench never approves silently or grants a session-wide permission. Inference still sends the prompt and any repository content Codex chooses to include to OpenAI under that person's account. Bench does not read or store login tokens. Codex itself keeps thread history on the local machine; Bench stores the thread identifier in `.bench` and visible messages in that browser's local storage.

## Security and privacy

Bench is a local development preview, not an isolated security container. It starts Codex only when you send a chat message. The server only binds to a loopback address; it rejects requests with a non-loopback Host, a foreign browser Origin, or cross-site Fetch Metadata. API changes require JSON, and the web server serves only the current orb page and its CSS and JavaScript. These checks protect against a malicious website trying to call the local API, but another program already running under your Windows account may still be able to access local files and services.

Rebuild Bench from this source before running it. An older executable may still have the earlier chat settings and will not show the new approval prompts.

Chat lets Codex edit the selected repository, run checks and perform requested Git work. Treat each permission prompt like a command you are about to run yourself: check the destination or file path before allowing it. The sandbox and prompts reduce risk but cannot guarantee that arbitrary code or a compromised local installation cannot affect your computer. Do not send a repository containing secrets you would not send to your own Codex account. Review changes before committing or publishing them.

The SQLite index contains local repository paths and notes; the repository-list response sends only the name, branch, ID, and commit count to the browser. The browser stores visible chat messages in its local storage without encryption. Use a private browser profile and protect your Windows account if that data is sensitive. Keep `.bench/` and other local databases out of Git; `.gitignore` excludes Bench's default database.

Open <http://127.0.0.1:7341> after Bench starts. The Go server serves the frontend from the web directory and the API from /api/; no separate frontend build is needed. Pass `-root` more than once to scan several folders. Bench does one full discovery scan when it starts, then keeps the project list in SQLite. Refreshing the repository list only reads those saved records. When you add a project, Bench checks only that path and requires it to be inside one of the configured roots. Bench listens only on a loopback address and stores its database under `.bench/` in the current directory. Use `-listen` or `-db` to change those settings.

## API

- `GET /api/health` — service health
- `GET /api/projects` — saved repository names, branches, IDs, and current commit counts; no filesystem scan
- `POST /api/projects` — inspect and add one Git repository: `{"path":"C:\\path\\to\\repo"}`
- `PUT /api/projects/{id}/note` — save or clear a project note
- `POST /api/projects/{id}/chat` — stream a Codex response for the selected repository using server-sent events
- `POST /api/approvals/{id}` — allow a pending Codex permission request once or decline it
- `GET /` — local orb preview

Project discovery asks Git for metadata using read-only commands and disables Git's filesystem monitor for those calls. It does not intentionally run repository scripts. The server binds to loopback, and project paths and notes stay in the local SQLite database.

## Checks

```powershell
go test ./...
go vet ./...
```
