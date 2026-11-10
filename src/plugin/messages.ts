// postMessage traffic between the plugin main thread (code.ts) and the UI iframe (ui/).
import type { Command, Result } from "../shared/protocol.ts";

export const SECRET_KEY = "fsm.secret";

export type MainToUi =
  | { type: "init"; secret?: string; fileName: string } // reply to `ready`
  | { type: "confirm"; id: number; summary: string } // ctx.confirm asks the user
  | { type: "confirm-cancel"; id: number } // confirm expired on the main thread; hide it
  | { type: "res"; res: Result };

export type UiToMain =
  | { type: "ready" } // UI loaded; main answers with `init`
  | { type: "cmd"; cmd: Command } // already verified against the hub signature
  | { type: "save-secret"; secret: string } // only after a verified code pairing
  | { type: "unpair" }
  | { type: "confirm-reply"; id: number; ok: boolean };
