import http from "node:http";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/http/server.js";
import { createRunRegistry } from "../src/runtime/run-registry.js";
import { resolveWorkspaceCwd } from "../src/runtime/workspace.js";
import type { PiClient } from "../src/runtime/runner.js";
import type { ToolCall, ToolResult } from "../src/core/types.js";

const buildPiClient = (options?: {
  delayMs?: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}): PiClient => ({
  runTurn: ({ signal }) =>
    new Promise((resolve, reject) => {
      const finish = () =>
        resolve({
          assistant_message: { content: "ok", finish_reason: "stop" },
          tool_calls: options?.toolCalls ?? [],
          tool_results: options?.toolResults ?? []
        });

      if (!options?.delayMs) {
        if (signal.aborted) {
          reject(new Error("aborted"));
          return;
        }
        finish();
        return;
      }

      const timer = setTimeout(finish, options.delayMs);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      };

      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    })
});

const startServer = (piClient: PiClient) =>
  new Promise<{ baseUrl: string; close: () => Promise<void>; registry: ReturnType<typeof createRunRegistry> }>(
    (resolve) => {
      const registry = createRunRegistry({ piClient });
      const server = createServer({
        registry,
      workspaceRoot: "/tmp/workspace",
      defaultRunTimeoutMs: 1000,
      defaultToolTimeoutMs: 1000,
      defaultMaxOutputBytes: 1024,
      resolveWorkspaceCwd
      });

      server.listen(0, () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          throw new Error("failed to bind server");
        }
        resolve({
          baseUrl: `http://127.0.0.1:${address.port}`,
          registry,
          close: () =>
            new Promise((done) => {
              server.close(() => done());
            })
        });
      });
    }
  );

const postJson = async (url: string, body: unknown) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  return { status: response.status, data };
};

describe("http server", () => {
  it("returns 400 for missing provider or system prompt", async () => {
    const { baseUrl, close } = await startServer(buildPiClient());

    const missingProvider = await postJson(`${baseUrl}/runs`, {
      run_id: "run-1",
      session_id: "session-1",
      system_prompt: "You are helpful.",
      model: "z-ai/glm-4.5-air:free",
      messages: [{ role: "user", content: "hi", timestamp: 1 }]
    });

    const missingSystemPrompt = await postJson(`${baseUrl}/runs`, {
      run_id: "run-2",
      session_id: "session-2",
      provider: "openrouter",
      model: "z-ai/glm-4.5-air:free",
      messages: [{ role: "user", content: "hi", timestamp: 1 }]
    });

    expect(missingProvider.status).toBe(400);
    expect(missingSystemPrompt.status).toBe(400);

    await close();
  });

  it("runs and returns assistant message", async () => {
    const { baseUrl, close } = await startServer(buildPiClient());

    const response = await postJson(`${baseUrl}/runs`, {
      run_id: "run-3",
      session_id: "session-3",
      system_prompt: "You are helpful.",
      provider: "openrouter",
      model: "z-ai/glm-4.5-air:free",
      messages: [{ role: "user", content: "ok", timestamp: 1 }]
    });

    const data = response.data as { status: string; assistant_message: { content: string } };

    expect(response.status).toBe(200);
    expect(data.status).toBe("ok");
    expect(data.assistant_message.content).toBe("ok");

    await close();
  });

  it("returns abort status for long run", async () => {
    const { baseUrl, close, registry } = await startServer(buildPiClient({ delayMs: 250 }));

    const runPromise = registry.startRun({
      run_id: "run-4",
      session_id: "session-4",
      system_prompt: "You are helpful.",
      provider: "openrouter",
      model: "z-ai/glm-4.5-air:free",
      messages: [{ role: "user", content: "wait", timestamp: 1 }],
      workspace_cwd: "/tmp/workspace",
      run_timeout_ms: 1000,
      tool_timeout_ms: 1000,
      max_output_bytes: 1024
    });

    const abortResponse = await postJson(`${baseUrl}/runs/run-4/abort`, {});
    expect(abortResponse.status).toBe(202);

    await runPromise;

    const runInfo = (await fetch(`${baseUrl}/runs/run-4`).then((res) => res.json())) as {
      result: { status: string };
    };
    expect(runInfo.result.status).toBe("aborted");

    await close();
  });

  it("streams events over SSE", async () => {
    const toolCalls: ToolCall[] = [{ id: "tool-1", name: "bash", input: { command: "pwd" } }];
    const toolResults: ToolResult[] = [
      {
        tool_call_id: "tool-1",
        name: "bash",
        output: {
          stdout: "/tmp",
          stderr: "",
          exit_code: 0,
          duration_ms: 1,
          truncated: false
        }
      }
    ];

    const { baseUrl, close } = await startServer(buildPiClient({ toolCalls, toolResults }));

    await postJson(`${baseUrl}/runs`, {
      run_id: "run-5",
      session_id: "session-5",
      system_prompt: "You are helpful.",
      provider: "openrouter",
      model: "z-ai/glm-4.5-air:free",
      messages: [{ role: "user", content: "ok", timestamp: 1 }]
    });

    const events: string[] = [];
    await new Promise<void>((resolve) => {
      const request = http.request(`${baseUrl}/runs/run-5/events`);
      request.end();

      request.on("response", (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          events.push(chunk);
          if (events.join("").includes("run_finished")) {
            request.destroy();
            resolve();
          }
        });
      });

      setTimeout(() => {
        request.destroy();
        resolve();
      }, 100);
    });

    const payload = events.join("");
    expect(payload).toContain("run_started");
    expect(payload).toContain("tool_started");
    expect(payload).toContain("tool_finished");
    expect(payload).toContain("run_finished");

    await close();
  });
});
