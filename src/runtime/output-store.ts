import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const OUTPUT_DIR = path.join(os.tmpdir(), "agent-worker");

export const storeFullOutput = async (params: {
  runId: string;
  toolCallId: string;
  stdout: string;
  stderr: string;
}): Promise<string> => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const filename = `${params.runId}-${params.toolCallId}-${Date.now()}.log`;
  const fullPath = path.join(OUTPUT_DIR, filename);
  const payload = [
    "[stdout]",
    params.stdout,
    "",
    "[stderr]",
    params.stderr,
    ""
  ].join("\n");
  await fs.writeFile(fullPath, payload, "utf8");
  return fullPath;
};
