// Plugin main thread (Figma sandbox). The UI iframe owns the hub WebSocket and the HMAC checks
// (WebCrypto is only available there); this side stores the pairing secret and runs verified commands.
import { dispatch, type Ctx } from "./dispatch.ts";
import { CONFIRM_TIMEOUT_MS } from "../shared/protocol.ts";
import "./commands/read.ts";
import "./commands/tokens.ts";
import "./commands/structure.ts";
import "./commands/edit.ts";
import "./commands/lint.ts";
import "./commands/batch.ts";
import { SECRET_KEY, type MainToUi, type UiToMain } from "./messages.ts";

export { PluginError, dispatch, register, type Ctx, type Handler } from "./dispatch.ts";

const post = (msg: MainToUi) => figma.ui.postMessage(msg);

// Expire a confirm a little before the hub gives up on the command (CONFIRM_TIMEOUT_MS), so a late
// Approve can never run a write whose result the agent will not see.
export const CONFIRM_EXPIRY_MS = CONFIRM_TIMEOUT_MS - 5000;

let confirmSeq = 0;
const confirms = new Map<number, (ok: boolean) => void>();

// One ctx per command: every confirm it asks expires at the earlier of its own expiry and the
// command deadline (arrival + CONFIRM_EXPIRY_MS), so a later ask in a batch cannot outlive the command.
function commandCtx(): Ctx {
  const deadline = Date.now() + CONFIRM_EXPIRY_MS;
  return {
    deadline,
    confirm(summary) {
      const ms = Math.min(CONFIRM_EXPIRY_MS, deadline - Date.now());
      if (ms <= 0) return Promise.resolve(false);
      return new Promise((resolve) => {
        const id = ++confirmSeq;
        const timer = setTimeout(() => {
          if (!confirms.delete(id)) return;
          post({ type: "confirm-cancel", id });
          resolve(false);
        }, ms);
        confirms.set(id, (ok) => {
          clearTimeout(timer);
          resolve(ok);
        });
        post({ type: "confirm", id, summary });
      });
    },
  };
}

figma.showUI(__html__, { width: 320, height: 440, themeColors: true });

figma.ui.onmessage = async (msg: UiToMain) => {
  switch (msg.type) {
    case "ready": {
      const stored = await figma.clientStorage.getAsync(SECRET_KEY);
      const fileName = figma.root.name;
      post(typeof stored === "string" && stored ? { type: "init", secret: stored, fileName } : { type: "init", fileName });
      return;
    }
    case "save-secret":
      await figma.clientStorage.setAsync(SECRET_KEY, msg.secret);
      return;
    case "unpair":
      await figma.clientStorage.deleteAsync(SECRET_KEY);
      return;
    case "cmd":
      post({ type: "res", res: await dispatch(msg.cmd, commandCtx()) });
      return;
    case "confirm-reply": {
      const resolve = confirms.get(msg.id);
      confirms.delete(msg.id);
      resolve?.(msg.ok);
      return;
    }
  }
};
