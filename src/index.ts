import { createServer } from "./http/server.js";
import { loadConfig } from "./runtime/config.js";
import { createRunRegistry } from "./runtime/run-registry.js";
import { resolveWorkspaceCwd } from "./runtime/workspace.js";
import { createPiClient } from "./adapters/pi-client.js";

const config = loadConfig();
const piClient = createPiClient({ workspaceRoot: config.workspaceRoot });
const registry = createRunRegistry({ piClient });

const server = createServer({
  registry,
  workspaceRoot: config.workspaceRoot,
  defaultRunTimeoutMs: config.defaultRunTimeoutMs,
  defaultToolTimeoutMs: config.defaultToolTimeoutMs,
  defaultMaxOutputBytes: config.defaultMaxOutputBytes,
  resolveWorkspaceCwd
});

server.listen(config.port, () => {
  console.log(`agent-worker listening on ${config.port}`);
});
