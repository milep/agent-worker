import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { runBashTool } from "../src/runtime/bash-tool.js";

describe("runBashTool", () => {
  it("truncates output and stores full output", async () => {
    const output = await runBashTool({
      runId: "run-1",
      toolCallId: "tool-1",
      input: { command: "printf 'hello world'" },
      workspaceRoot: process.cwd(),
      defaultCwd: process.cwd(),
      timeoutMs: 1000,
      maxOutputBytes: 5,
      signal: new AbortController().signal
    });

    expect(output.truncated).toBe(true);
    expect(output.stdout.length).toBeGreaterThan(0);
    expect(output.full_output_path).toBeTruthy();

    if (output.full_output_path) {
      const data = await fs.readFile(output.full_output_path, "utf8");
      expect(data).toContain("hello world");
    }
  });
});
