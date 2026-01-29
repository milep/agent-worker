import { z } from "zod";
import type { Message, RunRequest } from "./types.js";

const messageSchema: z.ZodType<Message> = z
  .object({
    role: z.string(),
    content: z.unknown().optional()
  })
  .passthrough();

const runRequestSchema = z
  .object({
    run_id: z.string().min(1),
    session_id: z.string().min(1),
    messages: z.array(messageSchema),
    provider: z.string().min(1),
    model: z.string().min(1),
    temperature: z.number().optional(),
    max_tokens: z.number().int().optional(),
    workspace_cwd: z.string().optional(),
    run_timeout_ms: z.number().int().positive().optional(),
    tool_timeout_ms: z.number().int().positive().optional(),
    max_output_bytes: z.number().int().positive().optional()
  })
  .strict();

export type ValidationResult =
  | { ok: true; value: RunRequest }
  | { ok: false; error: string };

type ValidationDefaults = {
  workspaceRoot: string;
  defaultRunTimeoutMs: number;
  defaultToolTimeoutMs: number;
  defaultMaxOutputBytes: number;
  resolveWorkspaceCwd: (workspaceRoot: string, cwd?: string) => string | null;
};

export const validateRunRequest = (
  payload: unknown,
  defaults: ValidationDefaults
): ValidationResult => {
  const parsed = runRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }

  const resolvedCwd = defaults.resolveWorkspaceCwd(
    defaults.workspaceRoot,
    parsed.data.workspace_cwd
  );
  if (!resolvedCwd) {
    return { ok: false, error: "workspace_cwd must be within workspace root" };
  }

  const request: RunRequest = {
    run_id: parsed.data.run_id,
    session_id: parsed.data.session_id,
    messages: parsed.data.messages,
    provider: parsed.data.provider,
    model: parsed.data.model,
    ...(parsed.data.temperature !== undefined ? { temperature: parsed.data.temperature } : {}),
    ...(parsed.data.max_tokens !== undefined ? { max_tokens: parsed.data.max_tokens } : {}),
    workspace_cwd: resolvedCwd,
    run_timeout_ms: parsed.data.run_timeout_ms ?? defaults.defaultRunTimeoutMs,
    tool_timeout_ms: parsed.data.tool_timeout_ms ?? defaults.defaultToolTimeoutMs,
    max_output_bytes: parsed.data.max_output_bytes ?? defaults.defaultMaxOutputBytes
  };

  return { ok: true, value: request };
};
