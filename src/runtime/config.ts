import os from "node:os";
import path from "node:path";

export const loadConfig = () => {
  const workspaceRoot = path.join(os.homedir(), "projects");

  return {
    port: 3000,
    workspaceRoot,
    defaultRunTimeoutMs: 5 * 60 * 1000,
    defaultToolTimeoutMs: 2 * 60 * 1000,
    defaultMaxOutputBytes: 51200
  };
};
