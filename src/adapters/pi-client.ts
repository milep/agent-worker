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
import type {
  AssistantMessage as PiAssistantMessage,
  Message as PiMessage,
  TextContent,
  ToolResultMessage,
  Usage
} from "@mariozechner/pi-ai";
import type { PiClient } from "../core/runner.js";
import type { AssistantMessage, Message, ToolCall, ToolOutput, ToolResult } from "../core/types.js";
import { runBashTool } from "../runtime/bash-tool.js";

type PiClientOptions = {
  workspaceRoot: string;
};

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0
  }
};

const toolSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  cwd: Type.Optional(Type.String({ description: "Working directory (optional)" })),
  timeout_ms: Type.Optional(Type.Number({ description: "Timeout in milliseconds (optional)" }))
});

const normalizeTextBlocks = (content: unknown): TextContent[] => {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  if (Array.isArray(content)) {
    const blocks: TextContent[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        blocks.push({ type: "text", text: part });
        continue;
      }
      if (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part) {
        blocks.push(part as TextContent);
        continue;
      }
      blocks.push({ type: "text", text: JSON.stringify(part) });
    }
    return blocks.length > 0 ? blocks : [{ type: "text", text: "" }];
  }
  return [{ type: "text", text: JSON.stringify(content) }];
};

const extractText = (content: unknown): string => {
  const blocks = normalizeTextBlocks(content);
  return blocks.map((block) => block.text).join("");
};

const buildSystemPrompt = (messages: Message[]): string | undefined => {
  const systemTexts = messages
    .filter((message) => message.role === "system")
    .map((message) => extractText(message.content));
  if (systemTexts.length === 0) {
    return undefined;
  }
  return systemTexts.join("\n\n");
};

const buildHistoryMessages = (messages: Message[], modelInfo: { api: string; provider: string; id: string }) => {
  const lastUserIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find((entry) => entry.message.role === "user")?.index;

  if (lastUserIndex === undefined) {
    throw new Error("no user message provided");
  }

  const promptMessage = messages[lastUserIndex];
  if (!promptMessage) {
    throw new Error("no user message provided");
  }
  const promptText = extractText(promptMessage.content);

  const history = messages.slice(0, lastUserIndex);
  const historyMessages: AgentMessage[] = [];

  for (const message of history) {
    if (message.role === "system") {
      continue;
    }
    if (message.role === "user") {
      historyMessages.push({
        role: "user",
        content: normalizeTextBlocks(message.content),
        timestamp: Date.now()
      });
      continue;
    }
    if (message.role === "assistant") {
      const assistantMessage: PiAssistantMessage = {
        role: "assistant",
        content: normalizeTextBlocks(message.content),
        api: modelInfo.api,
        provider: modelInfo.provider,
        model: modelInfo.id,
        usage: EMPTY_USAGE,
        stopReason: "stop",
        timestamp: Date.now()
      };
      historyMessages.push(assistantMessage);
      continue;
    }
    if (message.role === "tool_result") {
      const toolResult: ToolResultMessage = {
        role: "toolResult",
        toolCallId: `tool-result-${historyMessages.length + 1}`,
        toolName: "tool",
        content: normalizeTextBlocks(message.content),
        isError: false,
        timestamp: Date.now()
      };
      historyMessages.push(toolResult);
    }
  }

  return { historyMessages, promptText };
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

    const fullOutputPath =
      details && typeof details === "object" && "fullOutputPath" in details
        ? String((details as { fullOutputPath?: string }).fullOutputPath)
        : undefined;
    const truncated =
      details && typeof details === "object" && ("truncation" in details || "fullOutputPath" in details);

    return {
      stdout: extractText((result as { content?: unknown }).content ?? ""),
      stderr: "",
      exit_code: isError ? 1 : 0,
      duration_ms: durationMs,
      truncated: Boolean(truncated),
      ...(fullOutputPath ? { full_output_path: fullOutputPath } : {})
    };
  }

  return {
    stdout: "",
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
  const mode = process.env.PI_CLIENT ?? "sdk";
  if (mode === "mock") {
    return {
      runTurn: ({ messages }) => Promise.resolve({
        assistant_message: { content: messages.at(-1)?.content ?? "", finish_reason: "stop" }
      })
    };
  }
  if (mode !== "sdk") {
    throw new Error(`unsupported PI_CLIENT mode: ${mode}`);
  }

  return {
    runTurn: async ({
      run_id,
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

      const systemPrompt = buildSystemPrompt(messages);
      const loader = new DefaultResourceLoader({
        cwd,
        systemPromptOverride: () => systemPrompt ?? "",
        agentsFilesOverride: () => ({ agentsFiles: [] }),
        skillsOverride: (current) => ({ skills: [], diagnostics: current.diagnostics }),
        promptsOverride: (current) => ({ prompts: [], diagnostics: current.diagnostics })
      });
      await loader.reload();

      const { historyMessages, promptText } = buildHistoryMessages(messages, {
        api: selectedModel.api,
        provider: selectedModel.provider,
        id: selectedModel.id
      });

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

      session.agent.replaceMessages(historyMessages as PiMessage[]);

      const toolCalls: ToolCall[] = [];
      const toolResults: ToolResult[] = [];
      const toolStartTimes = new Map<string, number>();
      let assistant: PiAssistantMessage | undefined;
      let usage: Usage | undefined;

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
        await session.prompt(promptText, { expandPromptTemplates: false });
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
