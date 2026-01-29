# Agent Worker

Privileged agent runtime service for single-run jobs dispatched by Sleeve.

## Quick start (local)

```sh
docker compose run --rm worker npm install
docker compose up
```

```sh
./scripts/curl-status.sh
./scripts/curl-run.sh
```

`POST /runs` expects:
- `system_prompt` as a string (Rails-provided)
- `messages` as Pi-native messages (`user`, `assistant`, `toolResult`) with timestamps
- `provider` + `model` required, and `messages` must end with a `user` prompt

## Endpoints

- `POST /runs`
- `GET /runs/:id`
- `POST /runs/:id/abort`
- `POST /runs/:id/interrupt`
- `GET /runs/:id/events`
- `GET /status`
