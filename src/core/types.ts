export type UserMessage = {
  role: "user";
  content?: unknown;
  timestamp: number;
};

export type AssistantMessageRecord = {
  role: "assistant";
  content?: unknown;
  api: string;
  provider: string;
  model: string;
  usage?: unknown;
  stopReason: string;
  errorMessage?: string;
  timestamp: number;
};

export type ToolResultMessage = {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content?: unknown;
  details?: unknown;
  isError: boolean;
  timestamp: number;
};

export type Message = UserMessage | AssistantMessageRecord | ToolResultMessage;

export type RunRequest = {
  run_id: string;
  session_id: string;
  system_prompt: string;
  messages: Message[];
  provider: string;
  model: string;
  temperature?: number;
  max_tokens?: number;
  workspace_cwd: string;
  run_timeout_ms: number;
  tool_timeout_ms: number;
  max_output_bytes: number;
};

export type ToolCall = {
  id: string;
  name: "bash" | string;
  input: unknown;
};

export type ToolResult = {
  tool_call_id: string;
  name: string;
  output: ToolOutput;
};

export type ToolOutput = {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
  truncated: boolean;
  full_output_path?: string;
};

export type AssistantMessage = {
  content: unknown;
  finish_reason: "stop" | "length" | "tool_calls" | string;
};

export type RunEvent =
  | { type: "run_started"; run_id: string; session_id: string }
  | { type: "tool_started"; run_id: string; tool_call: ToolCall }
  | { type: "tool_finished"; run_id: string; tool_result: ToolResult }
  | { type: "assistant_message"; run_id: string; assistant_message: AssistantMessage }
  | { type: "run_finished"; run_id: string }
  | { type: "run_failed"; run_id: string; error: string }
  | { type: "run_aborted"; run_id: string };

export type RunResult = {
  run_id: string;
  session_id: string;
  assistant_message?: AssistantMessage;
  events: RunEvent[];
  tool_calls: ToolCall[];
  tool_results: ToolResult[];
  usage?: unknown;
  status: "ok" | "error" | "aborted";
  error?: string;
  truncated: boolean;
  full_output_path?: string;
};
