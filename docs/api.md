# Agent Worker API

## POST /runs

Run a single agent turn. Rails must send a Pi-native payload.

Required fields:
- `run_id`: string (UUID)
- `session_id`: string
- `system_prompt`: string
- `provider`: string (e.g. `openrouter`)
- `model`: string (e.g. `z-ai/glm-4.5-air:free`)
- `messages`: array of Pi messages with timestamps; must end with a `user` message

Optional:
- `workspace_cwd`: string (relative to workspace root, default: workspace root)
- `run_timeout_ms`: number
- `tool_timeout_ms`: number
- `max_output_bytes`: number
- `temperature`: number
- `max_tokens`: number

Message shapes (Pi-native):

```json
{
  "role": "user",
  "content": [{ "type": "text", "text": "Do X" }],
  "timestamp": 1730000000000
}
```

```json
{
  "role": "assistant",
  "content": [{ "type": "text", "text": "Done" }],
  "api": "openai-responses",
  "provider": "openrouter",
  "model": "z-ai/glm-4.5-air:free",
  "usage": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } },
  "stopReason": "stop",
  "timestamp": 1730000001000
}
```

```json
{
  "role": "toolResult",
  "toolCallId": "tool-1",
  "toolName": "bash",
  "content": [{ "type": "text", "text": "ok" }],
  "isError": false,
  "timestamp": 1730000002000
}
```

Response:
- `assistant_message` (Pi assistant content + stop reason)
- `tool_calls[]` / `tool_results[]`
- `events[]` (run/tool lifecycle)
- `status`: `ok` | `error` | `aborted`

## GET /runs/:id

Returns the cached run result and recorded events.

## POST /runs/:id/abort

Aborts a running run. Returns `202` when the abort signal is accepted.

## POST /runs/:id/interrupt

Not implemented (returns `501`).

## GET /runs/:id/events

SSE stream of run events (past events are replayed on connect).

## GET /status

Returns readiness + busy state.
