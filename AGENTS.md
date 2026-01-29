# AGENTS.md

## Purpose
- Node.js / TypeScript agent-worker service (privileged runtime)
- Local dev prefers Docker when available; host Node ok if no Docker config

## Coding Style (For Agents)
- Greenfield: no backward-compat layers; when behavior changes, update callers/tests.
- Internal service for superuser workflows: pick one clear approach, avoid config matrices.
- Start concrete; extract only when duplication is real.
- Prefer small dependency surface; avoid heavy frameworks unless clearly justified.
- Architecture: functional core + platform shell.
  - **Core** (`src/core`, `src/logic`):
    - Pure functions/modules.
    - Data in → data out.
    - No side effects (no I/O, no time/random/global state).
    - Dependencies passed explicitly.
  - **Shell** (`src/http`, `src/runtime`, `src/adapters`):
    - HTTP server, process/runtime, filesystem/tool execution.
    - Fetch inputs, call core, emit side effects.
    - Business rules do *not* live here.
- API shape:
  - Prefer modules + functions over classes.
  - Public entrypoints use typed objects (named fields).
  - Return explicit result types (`Result<T, E>` or discriminated unions), never `null` for errors.
- State & persistence:
  - If persistence exists, keep it behind adapters.
  - Core must not know *how* or *where* data is stored.
- TypeScript style:
  - `strict` mode assumed.
  - Prefer explicit types at module boundaries.
  - Avoid `any`; use `unknown` + narrowing when needed.
  - Comments explain *why*, not *what*.
  - Delete dead code aggressively.

## Docker Runtime & Commands
- Use Docker Compose for all commands (avoid raw `docker run`).
- If running inside a dev container, do not use Docker Compose (not installed).
  - Detect by checking `/.dockerenv` or `/proc/1/cgroup` for `docker`/`containerd`.
  - In-container equivalents: `npm test`, `npm run lint`, `npm run typecheck`.
- Start the service:
  - `docker compose up`
- Logs are the primary feedback mechanism.
- Open a shell in the worker container:
  - `docker compose run --rm worker sh`
- Install dependencies (populates the named `node_modules` volume):
  - `docker compose run --rm worker npm install`
- Run tests:
  - `docker compose run --rm worker npm test`
- Run lint/typecheck:
  - `docker compose run --rm worker npm run lint`
  - `docker compose run --rm worker npm run typecheck`

## Agent Automation
- After code changes, automatically run:
  - `docker compose run --rm worker npm test`
  - `docker compose run --rm worker npm run lint`
  - `docker compose run --rm worker npm run typecheck`
- For HTTP checks, use `docker compose exec -T worker curl` against 127.0.0.1 when the service is running.
- It is OK to start the stack with `docker compose up -d` to run those checks.

## Testing
- Core:
  - Pure unit tests, no I/O, no network.
- Shell:
  - Adapter-level tests with mocks/fakes.
- Every task must have either:
  - Automated tests, or
  - A clearly described manual validation step.

## Environment & Configuration
- Dev environment variables live in:
  - `.env` (dummy defaults, committed)
  - `.env.example` (documentation)
  - `.env.local` (machine-specific secrets, gitignored)
- Do not read `.env` files in automation or agent workflows.
- Only use environment variables when values are expected to differ across environments (dev vs prod). Otherwise prefer static code defaults.
- `.env` is secrets-only (example: `OPENROUTER_API_KEY`); non-secret config must live in code config files.
- Do not hardcode IDs or tokens.

## Deployment
- Single-container deployment model.
- Build produces a deterministic production image.
- Runtime configuration is entirely via environment variables.
- No CI-side deployment automation unless explicitly added later.
- Deployment target assumptions (unless stated otherwise):
  - Ubuntu LTS VPS
  - Docker installed
  - Worker runs as a single long-lived process

## Notes
- `node_modules` is not committed.
- Lockfile *is* committed.
- Keep startup deterministic: no hidden migrations, no implicit side effects on boot.
- One run at a time; no internal queueing.
- Dev smoke tests use model: `openrouter/z-ai/glm-4.5-air:free`.
- Dev smoke tests use prompt: `System: You are helpful assistant.\n\nUser: respond with ok`.

## Shared Files (Agent Inbox)
- Repo symlink: `agent-inbox` in the project root.
- Treat `agent-inbox` as read-only unless explicitly instructed otherwise.
- When asked to process a shared note, you may delete it after copying if explicitly requested.
- "shared files" refers to `agent-inbox/files`.
- If a request names a shared file, list `agent-inbox/files` and match the closest filename before moving it.
- Latest screenshot: use `agent-inbox/shots/latest.png`.
- Latest shared text: use `agent-inbox/text/latest.md`.
- When asked for "note 108", read `agent-inbox/text/note-108.md` (same pattern for other note numbers).
