import { Type } from "@sinclair/typebox";
import {
  AuthStorage,
  createAgentSession,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type ToolDefinition
} from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage as PiAssistantMessage } from "@mariozechner/pi-ai";
import type { PiClient } from "../runtime/runner.js";
import type { AssistantMessage, ToolCall, ToolOutput, ToolResult } from "../core/types.js";
import { runBashTool } from "../runtime/bash-tool.js";

type PiClientOptions = {
  workspaceRoot: string;
};

const toolSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  cwd: Type.Optional(Type.String({ description: "Working directory (optional)" })),
  timeout_ms: Type.Optional(Type.Number({ description: "Timeout in milliseconds (optional)" }))
});

const extractText = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part) {
          return String((part as { text: unknown }).text);
        }
        return JSON.stringify(part);
      })
      .join("");
  }
  if (content === undefined) {
    return "";
  }
  return JSON.stringify(content);
};

const buildToolOutput = (result: unknown, isError: boolean, durationMs: number): ToolOutput => {
  if (result && typeof result === "object" && "details" in result) {
    const details = (result as { details?: unknown }).details;
    if (
      details &&
      typeof details === "object" &&
      "stdout" in details &&
      "stderr" in details &&
      "exit_code" in details &&
      "duration_ms" in details &&
      "truncated" in details
    ) {
      return details as ToolOutput;
    }
  }

  return {
    stdout: extractText((result as { content?: unknown } | undefined)?.content ?? ""),
    stderr: "",
    exit_code: isError ? 1 : 0,
    duration_ms: durationMs,
    truncated: false
  };
};

const createBashTool = (params: {
  runId: string;
  workspaceRoot: string;
  defaultCwd: string;
  toolTimeoutMs: number;
  maxOutputBytes: number;
}): ToolDefinition => ({
  name: "bash",
  label: "bash",
  description: "Execute a bash command and return stdout/stderr.",
  parameters: toolSchema,
  execute: async (toolCallId, input, _onUpdate, _ctx, signal) => {
    const output = await runBashTool({
      runId: params.runId,
      toolCallId,
      input,
      workspaceRoot: params.workspaceRoot,
      defaultCwd: params.defaultCwd,
      timeoutMs: params.toolTimeoutMs,
      maxOutputBytes: params.maxOutputBytes,
      signal: signal ?? new AbortController().signal
    });

    const combined = [output.stdout, output.stderr].filter(Boolean).join("\n");

    return {
      content: [{ type: "text", text: combined || "(no output)" }],
      details: output
    };
  }
});

export const createPiClient = (options: PiClientOptions): PiClient => {
  return {
    runTurn: async ({
      run_id,
      system_prompt,
      messages,
      provider,
      model,
      temperature: _temperature,
      max_tokens: _max_tokens,
      cwd,
      tool_timeout_ms,
      max_output_bytes,
      signal
    }) => {
      const authStorage = new AuthStorage();
      const modelRegistry = new ModelRegistry(authStorage);

      if (process.env.OPENROUTER_API_KEY) {
        authStorage.setRuntimeApiKey("openrouter", process.env.OPENROUTER_API_KEY);
      }

      if (!provider || !model) {
        throw new Error("provider and model are required");
      }

      let selectedModel = modelRegistry.find(provider, model);

      if (!selectedModel) {
        throw new Error(`Model not found: ${provider}/${model}`);
      }

      const loader = new DefaultResourceLoader({
        cwd,
        agentsFilesOverride: () => ({ agentsFiles: [] }),
        skillsOverride: (current) => ({ skills: [], diagnostics: current.diagnostics }),
        promptsOverride: (current) => ({ prompts: [], diagnostics: current.diagnostics })
      });
      await loader.reload();

      if (messages.length === 0) {
        throw new Error("messages must include a user prompt");
      }
      const promptMessage = messages[messages.length - 1];
      if (!promptMessage || promptMessage.role !== "user") {
        throw new Error("messages must end with a user prompt");
      }
      const historyMessages = messages.slice(0, -1) as AgentMessage[];

      const tools = [
        createReadTool(cwd),
        createEditTool(cwd),
        createWriteTool(cwd),
        createGrepTool(cwd),
        createFindTool(cwd),
        createLsTool(cwd)
      ];

      const customTools = [
        createBashTool({
          runId: run_id,
          workspaceRoot: options.workspaceRoot,
          defaultCwd: cwd,
          toolTimeoutMs: tool_timeout_ms,
          maxOutputBytes: max_output_bytes
        })
      ];

      const { session } = await createAgentSession({
        cwd,
        model: selectedModel,
        authStorage,
        modelRegistry,
        tools,
        customTools,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(),
        settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } })
      });

      session.agent.setSystemPrompt(system_prompt);
      session.agent.replaceMessages(historyMessages);

      const toolCalls: ToolCall[] = [];
      const toolResults: ToolResult[] = [];
      const toolStartTimes = new Map<string, number>();
      let assistant: PiAssistantMessage | undefined;
      let usage: unknown;

      const unsubscribe = session.subscribe((event) => {
        if (event.type === "tool_execution_start") {
          toolStartTimes.set(event.toolCallId, Date.now());
          toolCalls.push({ id: event.toolCallId, name: event.toolName, input: event.args });
        }
        if (event.type === "tool_execution_end") {
          const startedAt = toolStartTimes.get(event.toolCallId) ?? Date.now();
          const durationMs = Date.now() - startedAt;
          toolResults.push({
            tool_call_id: event.toolCallId,
            name: event.toolName,
            output: buildToolOutput(event.result, event.isError, durationMs)
          });
        }
        if (event.type === "turn_end") {
          if (event.message.role === "assistant") {
            assistant = event.message as PiAssistantMessage;
            usage = assistant.usage;
          }
        }
      });

      const abortListener = async () => {
        await session.abort();
      };
      if (signal.aborted) {
        await abortListener();
      } else {
        signal.addEventListener("abort", abortListener, { once: true });
      }

      try {
        await session.agent.prompt(promptMessage as AgentMessage);
        await session.agent.waitForIdle();
      } finally {
        signal.removeEventListener("abort", abortListener);
        unsubscribe();
        session.dispose();
      }

      if (!assistant) {
        throw new Error("No assistant response received");
      }

      const assistantMessage: AssistantMessage = {
        content: assistant.content,
        finish_reason: assistant.stopReason
      };

      return {
        assistant_message: assistantMessage,
        tool_calls: toolCalls,
        tool_results: toolResults,
        ...(usage ? { usage } : {})
      };
    }
  };
};
