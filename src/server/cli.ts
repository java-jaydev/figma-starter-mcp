#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileSecretStore } from "./pairing.ts";
import { startBridge } from "./peer.ts";
import { createMcpServer } from "./mcp.ts";

// Resolved from this file, not the cwd; works from both src/server and dist/server.
export function pluginManifestPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "plugin", "manifest.json");
}

type Io = { out: (s: string) => void; err: (s: string) => void };

// stdout belongs to MCP: everything except plugin-path output goes to stderr.
export async function run(argv: string[], io: Io): Promise<void> {
  const cmd = argv[0];
  if (cmd === "plugin-path") return io.out(pluginManifestPath());
  if (cmd === "unpair") {
    await fileSecretStore().clearPlugin();
    return io.err("Plugin pairing cleared. It takes effect when the hub restarts (close all AI sessions using figma-starter-mcp, then start again).");
  }
  if (cmd !== undefined) {
    io.err(`Unknown command: ${cmd}. Usage: figma-starter-mcp [plugin-path | unpair]`);
    process.exitCode = 1;
    return;
  }
  const bridge = await startBridge({ store: fileSecretStore() });
  const mcp = createMcpServer(bridge);
  await mcp.connect(new StdioServerTransport());
  io.err("figma-starter-mcp ready");
  const stop = () => void bridge.close().finally(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdin.once("close", stop);
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2), { out: (s) => console.log(s), err: (s) => console.error(s) }).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
