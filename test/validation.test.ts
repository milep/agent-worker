import { describe, expect, it } from "vitest";
import { validateRunRequest } from "../src/core/validation.js";
import { resolveWorkspaceCwd } from "../src/runtime/workspace.js";

describe("validateRunRequest", () => {
  const defaults = {
    workspaceRoot: "/tmp/workspace",
    defaultRunTimeoutMs: 1000,
    defaultToolTimeoutMs: 1000,
    defaultMaxOutputBytes: 1024,
    resolveWorkspaceCwd
  };

  it("accepts a valid payload", () => {
    const result = validateRunRequest(
      {
        run_id: "run-1",
        session_id: "session-1",
        system_prompt: "You are helpful.",
        provider: "openrouter",
        model: "z-ai/glm-4.5-air:free",
        messages: [{ role: "user", content: "hi", timestamp: 1 }]
      },
      defaults
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.workspace_cwd).toBe("/tmp/workspace");
      expect(result.value.run_timeout_ms).toBe(1000);
    }
  });

  it("rejects workspace_cwd outside root", () => {
    const result = validateRunRequest(
      {
        run_id: "run-2",
        session_id: "session-2",
        system_prompt: "You are helpful.",
        provider: "openrouter",
        model: "z-ai/glm-4.5-air:free",
        messages: [{ role: "user", content: "hi", timestamp: 1 }],
        workspace_cwd: "/etc"
      },
      defaults
    );

    expect(result.ok).toBe(false);
  });
});
