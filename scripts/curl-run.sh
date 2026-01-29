#!/usr/bin/env sh
curl -sS -X POST http://localhost:3000/runs \
  -H "Content-Type: application/json" \
  -d '{
    "run_id": "run-123",
    "session_id": "session-123",
    "provider": "openrouter",
    "model": "z-ai/glm-4.5-air:free",
    "messages": [
      { "role": "system", "content": "You are helpful." },
      { "role": "user", "content": "respond with ok" }
    ]
  }'
