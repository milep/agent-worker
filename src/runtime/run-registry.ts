import type { RunEvent, RunRequest, RunResult } from "../core/types.js";
import type { RunDependencies } from "../core/runner.js";
import { runOnce } from "../core/runner.js";

type RunRecord = {
  request: RunRequest;
  status: "running" | "finished" | "failed" | "aborted";
  result?: RunResult;
  error?: string;
  controller: AbortController;
  events: RunEvent[];
  subscribers: Set<(event: RunEvent) => void>;
  startedAt: number;
  finishedAt?: number;
};

export type StartRunResult =
  | { type: "busy"; run_id: string }
  | { type: "running"; run_id: string }
  | { type: "cached"; result: RunResult }
  | { type: "completed"; result: RunResult };

export type RunRegistry = {
  startRun: (request: RunRequest) => Promise<StartRunResult>;
  getRun: (runId: string) => RunRecord | undefined;
  subscribe: (runId: string, handler: (event: RunEvent) => void) => boolean;
  unsubscribe: (runId: string, handler: (event: RunEvent) => void) => void;
  getStatus: () => { busy: boolean; current_run_id?: string };
  abortRun: (runId: string) => boolean;
};

export const createRunRegistry = (deps: Omit<RunDependencies, "emit">): RunRegistry => {
  const runs = new Map<string, RunRecord>();
  let currentRunId: string | undefined;

  const emitForRun = (runId: string, event: RunEvent): void => {
    const record = runs.get(runId);
    if (!record) {
      return;
    }
    record.events.push(event);
    for (const subscriber of record.subscribers) {
      subscriber(event);
    }
  };

  const startRun = async (request: RunRequest): Promise<StartRunResult> => {
    const existing = runs.get(request.run_id);
    if (existing) {
      if (existing.status === "running") {
        return { type: "running", run_id: request.run_id };
      }
      if (existing.result) {
        return { type: "cached", result: existing.result };
      }
    }

    if (currentRunId && currentRunId !== request.run_id) {
      return { type: "busy", run_id: currentRunId };
    }

    const controller = new AbortController();
    const record: RunRecord = {
      request,
      status: "running",
      controller,
      events: [],
      subscribers: new Set(),
      startedAt: Date.now()
    };

    runs.set(request.run_id, record);
    currentRunId = request.run_id;

    const timeout = setTimeout(() => {
      controller.abort();
    }, request.run_timeout_ms);

    try {
      const result = await runOnce(
        request,
        {
          ...deps,
          emit: (event) => emitForRun(request.run_id, event)
        },
        controller.signal
      );
      clearTimeout(timeout);
      record.result = result;
      record.status = result.status === "ok" ? "finished" : result.status === "aborted" ? "aborted" : "failed";
      record.finishedAt = Date.now();
      currentRunId = undefined;
      return { type: "completed", result };
    } catch (error) {
      clearTimeout(timeout);
      const message = error instanceof Error ? error.message : "unknown error";
      const result: RunResult = {
        run_id: request.run_id,
        session_id: request.session_id,
        events: record.events,
        tool_calls: [],
        tool_results: [],
        status: "error",
        error: message,
        truncated: false
      };
      record.result = result;
      record.status = "failed";
      record.error = message;
      record.finishedAt = Date.now();
      currentRunId = undefined;
      return { type: "completed", result };
    }
  };

  const getRun = (runId: string): RunRecord | undefined => runs.get(runId);

  const subscribe = (runId: string, handler: (event: RunEvent) => void): boolean => {
    const record = runs.get(runId);
    if (!record) {
      return false;
    }
    record.subscribers.add(handler);
    return true;
  };

  const unsubscribe = (runId: string, handler: (event: RunEvent) => void): void => {
    const record = runs.get(runId);
    if (!record) {
      return;
    }
    record.subscribers.delete(handler);
  };

  const getStatus = () => ({
    busy: Boolean(currentRunId),
    ...(currentRunId ? { current_run_id: currentRunId } : {})
  });

  const abortRun = (runId: string): boolean => {
    const record = runs.get(runId);
    if (!record || record.status !== "running") {
      return false;
    }
    record.controller.abort();
    return true;
  };

  return {
    startRun,
    getRun,
    subscribe,
    unsubscribe,
    getStatus,
    abortRun
  };
};
