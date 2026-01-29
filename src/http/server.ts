import http from "node:http";
import { URL } from "node:url";
import type { RunRegistry } from "../runtime/run-registry.js";
import { validateRunRequest } from "../core/validation.js";
import type { RunEvent } from "../core/types.js";
import type { ValidationResult } from "../core/validation.js";

type ServerDeps = {
  registry: RunRegistry;
  workspaceRoot: string;
  defaultRunTimeoutMs: number;
  defaultToolTimeoutMs: number;
  defaultMaxOutputBytes: number;
  resolveWorkspaceCwd: (workspaceRoot: string, cwd?: string) => string | null;
};

const sendJson = (res: http.ServerResponse, statusCode: number, payload: unknown): void => {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body).toString()
  });
  res.end(body);
};

const readJsonBody = async (req: http.IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return null;
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
};

const sendSseEvent = (res: http.ServerResponse, event: RunEvent): void => {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
};

const validatePayload = (payload: unknown, deps: ServerDeps): ValidationResult =>
  validateRunRequest(payload, {
    workspaceRoot: deps.workspaceRoot,
    defaultRunTimeoutMs: deps.defaultRunTimeoutMs,
    defaultToolTimeoutMs: deps.defaultToolTimeoutMs,
    defaultMaxOutputBytes: deps.defaultMaxOutputBytes,
    resolveWorkspaceCwd: deps.resolveWorkspaceCwd
  });

export const createServer = (deps: ServerDeps): http.Server => {
  return http.createServer(async (req, res) => {
    const url = req.url ? new URL(req.url, `http://${req.headers.host ?? "localhost"}`) : null;
    const method = req.method ?? "GET";
    const pathname = url?.pathname ?? "/";

    if (method === "GET" && pathname === "/status") {
      const status = deps.registry.getStatus();
      return sendJson(res, 200, { ok: true, ...status });
    }

    if (method === "POST" && pathname === "/runs") {
      try {
        const payload = await readJsonBody(req);
        const validated = validatePayload(payload, deps);
        if (!validated.ok) {
          return sendJson(res, 400, { status: "error", error: validated.error });
        }

        const result = await deps.registry.startRun(validated.value);
        if (result.type === "busy") {
          return sendJson(res, 409, { status: "busy", current_run_id: result.run_id });
        }
        if (result.type === "running") {
          return sendJson(res, 409, { status: "running", run_id: result.run_id });
        }
        return sendJson(res, 200, result.result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        return sendJson(res, 500, { status: "error", error: message });
      }
    }

    const runIdMatch = pathname.match(/^\/runs\/([^/]+)$/);
    if (method === "GET" && runIdMatch) {
      const runId = runIdMatch[1];
      if (!runId) {
        return sendJson(res, 400, { status: "error", error: "run_id missing" });
      }
      const record = deps.registry.getRun(runId);
      if (!record) {
        return sendJson(res, 404, { status: "error", error: "run not found" });
      }
      return sendJson(res, 200, {
        run_id: runId,
        status: record.status,
        result: record.result,
        events: record.events
      });
    }

    const abortMatch = pathname.match(/^\/runs\/([^/]+)\/abort$/);
    if (method === "POST" && abortMatch) {
      const runId = abortMatch[1];
      if (!runId) {
        return sendJson(res, 400, { status: "error", error: "run_id missing" });
      }
      const ok = deps.registry.abortRun(runId);
      if (!ok) {
        return sendJson(res, 409, { status: "error", error: "run not running" });
      }
      return sendJson(res, 202, { status: "ok", run_id: runId });
    }

    const interruptMatch = pathname.match(/^\/runs\/([^/]+)\/interrupt$/);
    if (method === "POST" && interruptMatch) {
      return sendJson(res, 501, { status: "error", error: "interrupt not implemented" });
    }

    const eventsMatch = pathname.match(/^\/runs\/([^/]+)\/events$/);
    if (method === "GET" && eventsMatch) {
      const runId = eventsMatch[1];
      if (!runId) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("run_id missing");
        return;
      }
      const record = deps.registry.getRun(runId);
      if (!record) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("run not found");
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });

      for (const event of record.events) {
        sendSseEvent(res, event);
      }

      const handler = (event: RunEvent) => {
        sendSseEvent(res, event);
      };
      deps.registry.subscribe(runId, handler);

      req.on("close", () => {
        deps.registry.unsubscribe(runId, handler);
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });
};
