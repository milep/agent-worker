#!/usr/bin/env sh
curl -sS -X POST http://localhost:3000/runs \
  -H "Content-Type: application/json" \
  -d '{
    "run_id": "run-123",
    "session_id": "session-123",
    "system_prompt": "You are helpful.",
    "provider": "openrouter",
    "model": "z-ai/glm-4.5-air:free",
    "messages": [
      { "role": "user", "content": "respond with ok", "timestamp": 1 }
    ]
  }'
