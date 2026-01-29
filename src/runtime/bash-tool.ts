import { spawn } from "node:child_process";
import { z } from "zod";
import { truncateText } from "../core/truncate.js";
import type { ToolOutput } from "../core/types.js";
import { storeFullOutput } from "./output-store.js";
import { resolveWorkspaceCwd } from "./workspace.js";

const bashInputSchema = z
  .object({
    command: z.string().min(1),
    cwd: z.string().optional(),
    timeout_ms: z.number().int().positive().optional()
  })
  .strict();

type BashToolInput = z.infer<typeof bashInputSchema>;

const parseBashInput = (input: unknown): BashToolInput => {
  const parsed = bashInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`invalid bash tool input: ${parsed.error.message}`);
  }
  return parsed.data;
};

export const runBashTool = async (params: {
  runId: string;
  toolCallId: string;
  input: unknown;
  workspaceRoot: string;
  defaultCwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal: AbortSignal;
}): Promise<ToolOutput> => {
  const parsed = parseBashInput(params.input);
  const resolvedCwd = resolveWorkspaceCwd(
    params.workspaceRoot,
    parsed.cwd ?? params.defaultCwd
  );
  if (!resolvedCwd) {
    throw new Error("bash tool cwd must be within workspace root");
  }

  const timeoutMs = parsed.timeout_ms ?? params.timeoutMs;
  const startedAt = Date.now();
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let killed = false;

  const child = spawn(parsed.command, {
    cwd: resolvedCwd,
    shell: true,
    env: process.env
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    killed = child.kill("SIGKILL");
  }, timeoutMs);

  const abortListener = () => {
    killed = child.kill("SIGKILL");
  };
  if (params.signal.aborted) {
    abortListener();
  } else {
    params.signal.addEventListener("abort", abortListener);
  }

  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const exitCode: number = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (typeof code === "number") {
        resolve(code);
        return;
      }
      if (signal) {
        resolve(1);
        return;
      }
      resolve(0);
    });
  });

  clearTimeout(timeout);
  params.signal.removeEventListener("abort", abortListener);

  const durationMs = Date.now() - startedAt;
  if (timedOut && !killed) {
    stderr += "\n[tool timeout exceeded]";
  }

  const truncatedStdout = truncateText(stdout, params.maxOutputBytes);
  const truncatedStderr = truncateText(stderr, params.maxOutputBytes);
  const truncated = truncatedStdout.truncated || truncatedStderr.truncated;

  let fullOutputPath: string | undefined;
  if (truncated) {
    fullOutputPath = await storeFullOutput({
      runId: params.runId,
      toolCallId: params.toolCallId,
      stdout,
      stderr
    });
  }

  return {
    stdout: truncatedStdout.text,
    stderr: truncatedStderr.text,
    exit_code: exitCode,
    duration_ms: durationMs,
    truncated,
    ...(fullOutputPath ? { full_output_path: fullOutputPath } : {})
  };
};
