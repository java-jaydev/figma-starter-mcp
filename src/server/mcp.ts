import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Bridge } from "./hub.ts";
import { TOOLS } from "./tools.ts";

type ToolResult = {
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
  isError?: boolean;
};

const ok = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

async function statusResult(bridge: Bridge, renew: boolean): Promise<ToolResult> {
  if (renew) await bridge.renewPairingCode();
  const s = bridge.status();
  if (s.pluginConnected) return ok(s);
  const instruction = s.pairingCode
    ? `Open Figma desktop, run Plugins > Development > figma-starter, and enter code ${s.pairingCode}`
    : "No pairing code is offered. Call status with renewPairingCode: true to get a new one.";
  return ok({ ...s, instruction });
}

export function createMcpServer(bridge: Bridge): McpServer {
  const mcp = new McpServer({ name: "figma-starter-mcp", version: "0.1.1" });
  const tools = new Map(TOOLS.map((t) => [t.name as string, t]));
  for (const t of TOOLS) {
    // Registered for tools/list (JSON schema); calls are handled below so a bad input
    // comes back as INVALID_INPUT instead of the SDK's generic validation error.
    mcp.registerTool(t.name, { description: t.description, inputSchema: t.input }, async () => fail("unreachable"));
  }

  mcp.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<ToolResult> => {
    const tool = tools.get(request.params.name);
    if (!tool) return fail(`INVALID_INPUT: unknown tool ${request.params.name}`);
    const parsed = tool.input.safeParse(request.params.arguments ?? {});
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`).join("; ");
      return fail(`INVALID_INPUT: ${msg}`);
    }
    if (tool.name === "status") {
      return statusResult(bridge, (parsed.data as { renewPairingCode?: boolean }).renewPairingCode === true);
    }
    const res = await bridge.send(tool.name, parsed.data, tool.confirm?.(parsed.data) ? { confirm: true } : undefined);
    if (res.ok) {
      // PNG goes back as image content so the agent (and the user) can see it; SVG stays JSON text.
      const png = res.data as { format?: string; base64?: string };
      if (tool.name === "export_node" && png.format === "PNG" && typeof png.base64 === "string") {
        return { content: [{ type: "image", data: png.base64, mimeType: "image/png" }] };
      }
      return ok(res.data);
    }
    return fail(`${res.code}: ${res.message}${res.hint ? `\n${res.hint}` : ""}`);
  });
  return mcp;
}
