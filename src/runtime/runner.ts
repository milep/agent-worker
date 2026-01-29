import type {
  AssistantMessage,
  Message,
  RunEvent,
  RunRequest,
  RunResult,
  ToolCall,
  ToolResult
} from "../core/types.js";

export type PiTurnResponse = {
  assistant_message: AssistantMessage;
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
  usage?: unknown;
  messages?: Message[];
};

export type PiClient = {
  runTurn: (input: {
    run_id: string;
    system_prompt: string;
    messages: Message[];
    provider?: string;
    model?: string;
    temperature?: number;
    max_tokens?: number;
    cwd: string;
    tool_timeout_ms: number;
    max_output_bytes: number;
    signal: AbortSignal;
  }) => Promise<PiTurnResponse>;
};

export type RunDependencies = {
  piClient: PiClient;
  emit: (event: RunEvent) => void;
};

export const runOnce = async (
  request: RunRequest,
  deps: RunDependencies,
  signal: AbortSignal
): Promise<RunResult> => {
  const toolCalls: ToolCall[] = [];
  const toolResults: ToolResult[] = [];
  const events: RunEvent[] = [];
  let truncated = false;
  let fullOutputPath: string | undefined;

  const emit = (event: RunEvent) => {
    events.push(event);
    deps.emit(event);
  };

  emit({ type: "run_started", run_id: request.run_id, session_id: request.session_id });

  const messages: Message[] = [...request.messages];

  let assistantMessage: AssistantMessage | undefined;
  let usage: unknown;

  if (signal.aborted) {
    emit({ type: "run_aborted", run_id: request.run_id });
    return {
      run_id: request.run_id,
      session_id: request.session_id,
      ...(assistantMessage ? { assistant_message: assistantMessage } : {}),
      events,
      tool_calls: toolCalls,
      tool_results: toolResults,
      ...(usage !== undefined ? { usage } : {}),
      status: "aborted",
      error: "run aborted",
      truncated,
      ...(fullOutputPath ? { full_output_path: fullOutputPath } : {})
    };
  }

  const piResponse = await deps.piClient.runTurn({
    run_id: request.run_id,
    system_prompt: request.system_prompt,
    messages,
    ...(request.provider ? { provider: request.provider } : {}),
    ...(request.model ? { model: request.model } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.max_tokens !== undefined ? { max_tokens: request.max_tokens } : {}),
    cwd: request.workspace_cwd,
    tool_timeout_ms: request.tool_timeout_ms,
    max_output_bytes: request.max_output_bytes,
    signal
  });

  usage = piResponse.usage;
  assistantMessage = piResponse.assistant_message;
  const calls = piResponse.tool_calls ?? [];
  const results = piResponse.tool_results ?? [];

  for (const toolCall of calls) {
    toolCalls.push(toolCall);
    emit({ type: "tool_started", run_id: request.run_id, tool_call: toolCall });
  }

  for (const result of results) {
    toolResults.push(result);
    if (result.output.truncated) {
      truncated = true;
      if (result.output.full_output_path) {
        fullOutputPath = result.output.full_output_path;
      }
    }
    emit({ type: "tool_finished", run_id: request.run_id, tool_result: result });
  }

  emit({
    type: "assistant_message",
    run_id: request.run_id,
    assistant_message: assistantMessage
  });
  emit({ type: "run_finished", run_id: request.run_id });

  return {
    run_id: request.run_id,
    session_id: request.session_id,
    assistant_message: assistantMessage,
    events,
    tool_calls: toolCalls,
    tool_results: toolResults,
    ...(usage !== undefined ? { usage } : {}),
    status: "ok",
    truncated,
    ...(fullOutputPath ? { full_output_path: fullOutputPath } : {})
  };
};
