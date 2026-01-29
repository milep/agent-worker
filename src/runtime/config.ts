import os from "node:os";
import path from "node:path";

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const loadConfig = () => {
  const workspaceRoot = process.env.WORKSPACE_ROOT ?? path.join(os.homedir(), "projects");

  return {
    port: parseNumber(process.env.PORT, 3000),
    workspaceRoot,
    defaultRunTimeoutMs: parseNumber(process.env.RUN_TIMEOUT_MS, 5 * 60 * 1000),
    defaultToolTimeoutMs: parseNumber(process.env.TOOL_TIMEOUT_MS, 2 * 60 * 1000),
    defaultMaxOutputBytes: parseNumber(process.env.MAX_OUTPUT_BYTES, 51200)
  };
};
