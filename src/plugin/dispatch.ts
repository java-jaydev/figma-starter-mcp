// Command registry for the plugin main thread. Command modules call `register`; code.ts calls `dispatch`
// for each command the UI has already verified. Kept apart from code.ts so command modules can import it
// without pulling in the code.ts startup side effects (and without an import cycle).
import type { Command, CommandName, ErrorCode, Result } from "../shared/protocol.ts";

// deadline: epoch ms after which the hub no longer waits for this command; confirm resolves false
// by then at the latest.
export type Ctx = { confirm(summary: string): Promise<boolean>; deadline?: number };
export type Handler = (args: any, ctx: Ctx) => Promise<unknown>;

export class PluginError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public hint?: string,
  ) {
    super(message);
  }
}

const handlers = new Map<CommandName, Handler>();

export function register(name: CommandName, h: Handler): void {
  handlers.set(name, h);
}

export function getHandler(name: CommandName): Handler | undefined {
  return handlers.get(name);
}

export async function dispatch(cmd: Command, ctx: Ctx): Promise<Result> {
  const { id, name } = cmd;
  const h = handlers.get(name);
  if (!h) return { id, ok: false, code: "INVALID_INPUT", message: `Unknown command: ${name}` };
  try {
    const data = await h(cmd.args, ctx);
    // One undo step per command, so Cmd+Z in Figma reverts exactly what the agent did.
    figma.commitUndo();
    return { id, ok: true, data };
  } catch (e) {
    if (e instanceof PluginError) {
      return e.hint === undefined
        ? { id, ok: false, code: e.code, message: e.message }
        : { id, ok: false, code: e.code, message: e.message, hint: e.hint };
    }
    return { id, ok: false, code: "INVALID_INPUT", message: e instanceof Error ? e.message : String(e) };
  }
}
