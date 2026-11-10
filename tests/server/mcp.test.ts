import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { COMMANDS, type CommandName, type Result } from "../../src/shared/protocol.ts";
import type { Bridge, BridgeStatus } from "../../src/server/hub.ts";
import { createMcpServer } from "../../src/server/mcp.ts";
import { run } from "../../src/server/cli.ts";

type Sent = { name: CommandName; args: unknown; opts?: { confirm?: boolean } };

function fakeBridge(reply: (name: CommandName) => Result, state: BridgeStatus) {
  const sent: Sent[] = [];
  let renewed = 0;
  const bridge: Bridge = {
    async send(name, args, opts) {
      sent.push({ name, args, opts });
      return reply(name);
    },
    status: () => state,
    // Like a peer, the new code only shows up in status() once the hub's state frame arrives.
    renewPairingCode: async () => {
      renewed++;
      await new Promise((r) => setTimeout(r, 10));
      if (!state.pluginConnected) state.pairingCode = "NEWCDE";
    },
    close: async () => {},
  };
  return { bridge, sent, renewed: () => renewed };
}

async function connect(bridge: Bridge) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(bridge).connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  return client;
}

const ok = (): Result => ({ id: "1", ok: true, data: { done: true } });
const connected: BridgeStatus = { role: "hub", pluginConnected: true, fileName: "f" };
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;
const isError = (r: unknown) => (r as { isError?: boolean }).isError === true;

describe("mcp tools", () => {
  it("lists exactly the COMMANDS", async () => {
    const client = await connect(fakeBridge(ok, connected).bridge);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...COMMANDS].sort());
  });

  it("rejects a raw token without reason as INVALID_INPUT", async () => {
    const f = fakeBridge(ok, connected);
    const client = await connect(f.bridge);
    const r = await client.callTool({ name: "create_frame", arguments: { name: "Card", fill: { raw: "#fff" } } });
    expect(isError(r)).toBe(true);
    expect(text(r)).toMatch(/^INVALID_INPUT:/);
    expect(f.sent).toEqual([]);
  });

  it("accepts a layout without gap or padding, and a create_text fill", async () => {
    const f = fakeBridge(ok, connected);
    const client = await connect(f.bridge);
    const a = await client.callTool({ name: "create_frame", arguments: { name: "Row", layout: { mode: "HORIZONTAL" } } });
    const b = await client.callTool({ name: "set_auto_layout", arguments: { id: "1:1", layout: { gap: { var: "space/4" } } } });
    const c = await client.callTool({ name: "create_text", arguments: { parentId: "1:1", text: "Hi", textStyle: "body/md", fill: { var: "color/fg/default" } } });
    expect([a, b, c].map(isError)).toEqual([false, false, false]);
    expect(f.sent.map((s) => s.name)).toEqual(["create_frame", "set_auto_layout", "create_text"]);
  });

  it("add_component_property does not offer VARIANT", async () => {
    const f = fakeBridge(ok, connected);
    const client = await connect(f.bridge);
    const r = await client.callTool({ name: "add_component_property", arguments: { componentId: "1:1", name: "size", type: "VARIANT", default: "large" } });
    expect(text(r)).toMatch(/^INVALID_INPUT:.*type/);
    expect(f.sent).toEqual([]);
  });

  it("export_node returns PNG as MCP image content and SVG as text", async () => {
    let format = "PNG";
    const f = fakeBridge((): Result => ({ id: "1", ok: true, data: { format, base64: "iVBORw0KGgo=" } }), connected);
    const client = await connect(f.bridge);
    const png = await client.callTool({ name: "export_node", arguments: { id: "1:1", format: "PNG" } });
    expect(isError(png)).toBe(false);
    expect((png as { content: unknown[] }).content).toEqual([{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }]);
    format = "SVG";
    const svg = await client.callTool({ name: "export_node", arguments: { id: "1:1", format: "SVG" } });
    expect((svg as { content: { type: string }[] }).content[0].type).toBe("text");
    expect(JSON.parse(text(svg))).toEqual({ format: "SVG", base64: "iVBORw0KGgo=" });
  });

  it("rejects unknown keys", async () => {
    const client = await connect(fakeBridge(ok, connected).bridge);
    const r = await client.callTool({ name: "rename", arguments: { id: "1:2", name: "A", extra: 1 } });
    expect(text(r)).toMatch(/^INVALID_INPUT:/);
  });

  it("forwards valid input and returns data as JSON", async () => {
    const f = fakeBridge(ok, connected);
    const client = await connect(f.bridge);
    const r = await client.callTool({
      name: "create_frame",
      arguments: { name: "Card", fill: { raw: "#fff", reason: "brand logo" }, radius: { var: "radius/md" } },
    });
    expect(isError(r)).toBe(false);
    expect(JSON.parse(text(r))).toEqual({ done: true });
    expect(f.sent[0].name).toBe("create_frame");
    expect(f.sent[0].opts?.confirm).toBeFalsy();
  });

  it("passes confirm for every delete_nodes and batch call", async () => {
    const f = fakeBridge(ok, connected);
    const client = await connect(f.bridge);
    await client.callTool({ name: "delete_nodes", arguments: { ids: ["1:1", "1:2", "1:3", "1:4", "1:5"] } });
    await client.callTool({ name: "delete_nodes", arguments: { ids: ["1:1"] } });
    await client.callTool({ name: "batch", arguments: { commands: [{ name: "rename", args: { id: "1:1", name: "A" } }] } });
    expect(f.sent.map((s) => s.opts?.confirm)).toEqual([true, true, true]);
  });

  it("validates batch items against their tool schema", async () => {
    const f = fakeBridge(ok, connected);
    const client = await connect(f.bridge);
    const r = await client.callTool({ name: "batch", arguments: { commands: [{ name: "rename", args: { id: "1:1" } }] } });
    expect(text(r)).toMatch(/^INVALID_INPUT:.*commands/);
    expect(f.sent).toEqual([]);
  });

  it("surfaces PLUGIN_NOT_CONNECTED with the one-line fix", async () => {
    const f = fakeBridge(
      (): Result => ({
        id: "1",
        ok: false,
        code: "PLUGIN_NOT_CONNECTED",
        message: "Figma plugin is not connected",
        hint: "Open Figma desktop, run Plugins > Development > figma-starter",
      }),
      { role: "hub", pluginConnected: false },
    );
    const client = await connect(f.bridge);
    const r = await client.callTool({ name: "read_page", arguments: {} });
    expect(isError(r)).toBe(true);
    expect(text(r)).toContain("PLUGIN_NOT_CONNECTED: Figma plugin is not connected");
    expect(text(r)).toContain("Open Figma desktop, run Plugins > Development > figma-starter");
  });

  it("status shows the pairing instruction and can renew the code", async () => {
    const f = fakeBridge(ok, { role: "hub", pluginConnected: false, pairingCode: "123456" });
    const client = await connect(f.bridge);
    const before = JSON.parse(text(await client.callTool({ name: "status", arguments: {} })));
    expect(before.instruction).toBe("Open Figma desktop, run Plugins > Development > figma-starter, and enter code 123456");
    const r = await client.callTool({ name: "status", arguments: { renewPairingCode: true } });
    expect(f.renewed()).toBe(1);
    const out = JSON.parse(text(r));
    expect(out.pluginConnected).toBe(false);
    expect(out.instruction).toBe("Open Figma desktop, run Plugins > Development > figma-starter, and enter code NEWCDE");
    expect(f.sent).toEqual([]);
  });

  it("status without a code says to renew", async () => {
    const client = await connect(fakeBridge(ok, { role: "peer", pluginConnected: false }).bridge);
    const out = JSON.parse(text(await client.callTool({ name: "status", arguments: {} })));
    expect(out.instruction).toContain("renewPairingCode: true");
  });

  it("status when connected has no instruction", async () => {
    const client = await connect(fakeBridge(ok, connected).bridge);
    const out = JSON.parse(text(await client.callTool({ name: "status", arguments: {} })));
    expect(out).toEqual(connected);
  });
});

describe("cli", () => {
  it("plugin-path prints an absolute manifest path", async () => {
    const lines: string[] = [];
    await run(["plugin-path"], { out: (s) => lines.push(s), err: () => {} });
    expect(lines[0].startsWith("/")).toBe(true);
    expect(lines[0].endsWith("dist/plugin/manifest.json")).toBe(true);
  });
});
