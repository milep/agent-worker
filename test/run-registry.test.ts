import { describe, expect, it } from "vitest";
import type { PiClient } from "../src/core/runner.js";
import type { RunRequest } from "../src/core/types.js";
import { createRunRegistry } from "../src/runtime/run-registry.js";

const createRequest = (runId: string): RunRequest => ({
  run_id: runId,
  session_id: "session",
  messages: [{ role: "user", content: "hello" }],
  workspace_cwd: "/tmp",
  run_timeout_ms: 1000,
  tool_timeout_ms: 1000,
  max_output_bytes: 1024
});

const createDelayedPiClient = (delayMs: number): PiClient => ({
  runTurn: ({ signal }) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve({ assistant_message: { content: "ok", finish_reason: "stop" } });
      }, delayMs);
      if (signal.aborted) {
        clearTimeout(timeout);
        reject(new Error("aborted"));
        return;
      }
      signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        reject(new Error("aborted"));
      });
    })
});

describe("run registry", () => {
  it("returns busy when another run is active", async () => {
    const registry = createRunRegistry({
      piClient: createDelayedPiClient(50)
    });

    const first = registry.startRun(createRequest("run-a"));
    const second = await registry.startRun(createRequest("run-b"));

    expect(second.type).toBe("busy");
    await first;
  });

  it("returns cached result for same run_id", async () => {
    const registry = createRunRegistry({
      piClient: createDelayedPiClient(10)
    });

    const first = await registry.startRun(createRequest("run-c"));
    expect(first.type).toBe("completed");

    const second = await registry.startRun(createRequest("run-c"));
    expect(second.type).toBe("cached");
  });
});
