// Connection logic of the UI iframe, free of DOM so it can be unit-tested. The iframe holds the
// WebSocket to the hub, does the mutual challenge-response, and verifies every command signature
// before anything reaches the plugin main thread. See server/hub.ts for the other side.
//
// Phases per socket: challenge -> welcome -> ready. Statuses shown to the user:
//   needs-code    no usable credential; waiting for the user to type the pairing code (no socket)
//   connecting    socket open or opening, handshake in progress
//   connected     hub proof verified; commands are accepted
//   disconnected  socket lost; a retry is scheduled every RECONNECT_MS
//   replaced      another plugin window took over; no retry (it would steal the link back)
//   untrusted     the server failed its proof; nothing stored, no retry
//   rejected      the hub denied the stored secret; no retry, the user may choose Pair again
//
// Confirm requests (ctx.confirm) are only valid while the link that carried the command is ready.
// When the link leaves ready (close, unpair, replaced, ...) every queued confirm is declined.
import { clientProof, cmdSigPayload, hubProof, sameProof, validNonce, type Hmac } from "../../shared/handshake.ts";
import { COMMANDS, PORT, type Command, type Envelope, type Result } from "../../shared/protocol.ts";
import type { UiToMain } from "../messages.ts";

export const HUB_URL = `ws://127.0.0.1:${PORT}`;
export const RECONNECT_MS = 2000;
export const LOG_SIZE = 20;
const REPLACED_CLOSE_CODE = 4000; // hub: "replaced by a newer plugin connection"

// The subset of the browser WebSocket this module uses.
export type SocketLike = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
};

export type ClientDeps = {
  hmac: Hmac;
  nonce(): string;
  openSocket(url: string): SocketLike;
  toMain(msg: UiToMain): void;
  onChange(view: ClientView): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
};

export type Status =
  | "needs-code"
  | "connecting"
  | "connected"
  | "disconnected"
  | "replaced"
  | "untrusted"
  | "rejected";
export type LogEntry = { id: string; name: string; state: "running" | "ok" | "error"; detail?: string };
export type ConfirmRequest = { id: number; summary: string };
export type ClientView = {
  status: Status;
  message: string;
  needsCode: boolean;
  canPairAgain: boolean;
  confirm?: ConfirmRequest; // the one shown now; others wait behind it
  log: LogEntry[];
};

const MESSAGES: Record<Status, string> = {
  "needs-code": "Enter the 6-character pairing code from your AI tool.",
  connecting: "Connecting to the figma-starter-mcp server...",
  connected: "Connected.",
  disconnected: "Server not running. Retrying every 2 s.",
  replaced: "Another figma-starter window took over the connection. Run the plugin again to reconnect.",
  untrusted: "The server on this port could not prove it is yours. Nothing was saved. Run the plugin again to retry.",
  rejected:
    "The server did not accept the stored pairing. If you restarted or reset the server, choose Pair again to enter a new code.",
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function parse(data: unknown): Envelope | null {
  try {
    const v: unknown = JSON.parse(String(data));
    return isObj(v) && typeof v.t === "string" ? (v as Envelope) : null;
  } catch {
    return null;
  }
}

const validCmd = (v: unknown): v is Command =>
  isObj(v) && typeof v.id === "string" && (COMMANDS as readonly unknown[]).includes(v.name);

type Link = {
  socket: SocketLike;
  phase: "challenge" | "welcome" | "ready";
  key?: string; // secret or pairing code used for this handshake
  pairing?: boolean;
  hubNonce?: string;
  clientNonce?: string;
};

export function createClient(deps: ClientDeps) {
  let secret: string | undefined;
  let code: string | undefined;
  let fileName = "";
  let link: Link | null = null;
  let timer: unknown = null;
  let status: Status = "needs-code";
  let message = MESSAGES["needs-code"];
  let log: LogEntry[] = [];
  let confirms: ConfirmRequest[] = [];
  // Socket events run one at a time, in arrival order, because HMAC is async:
  // a cmd that arrives right behind the welcome must wait until the welcome is verified.
  let chain: Promise<void> = Promise.resolve();

  const view = (): ClientView => ({
    status,
    message,
    needsCode: status === "needs-code",
    canPairAgain: status === "rejected",
    confirm: confirms[0],
    log: log.slice(),
  });
  const setStatus = (s: Status, msg = MESSAGES[s]) => {
    status = s;
    message = msg;
    deps.onChange(view());
  };
  const addLog = (e: LogEntry) => {
    log = [e].concat(log.filter((x) => x.id !== e.id)).slice(0, LOG_SIZE);
    deps.onChange(view());
  };

  function stopTimer() {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  }

  // The link that asked is gone, so no queued confirm may be approved any more.
  function declineAll() {
    const pending = confirms;
    confirms = [];
    for (const c of pending) deps.toMain({ type: "confirm-reply", id: c.id, ok: false });
  }

  // Detaches the current socket so its late events are ignored, then closes it.
  function drop() {
    const old = link;
    link = null;
    declineAll();
    if (old) {
      old.socket.onmessage = null;
      old.socket.onclose = null;
      old.socket.close();
    }
  }

  function connect() {
    stopTimer();
    drop();
    if (!secret && !code) return setStatus("needs-code");
    const socket = deps.openSocket(HUB_URL);
    const l: Link = { socket, phase: "challenge" };
    link = l;
    socket.onmessage = (ev) => {
      chain = chain.then(() => onMessage(l, ev.data)).catch(() => {});
    };
    socket.onclose = (ev) => {
      chain = chain.then(() => onClose(l, ev.code));
    };
    setStatus("connecting");
  }

  // Ends this link and stays put (no retry) in the given status.
  function halt(l: Link, s: Status, msg?: string) {
    if (link !== l) return;
    drop();
    stopTimer();
    setStatus(s, msg);
  }

  async function onMessage(l: Link, data: unknown) {
    if (link !== l) return;
    const msg = parse(data);
    if (l.phase === "challenge") {
      if (msg?.t !== "challenge" || !validNonce(msg.nonce)) return l.socket.close();
      const pairing = code !== undefined;
      const key = pairing ? code! : secret!;
      const clientNonce = deps.nonce();
      const proof = await clientProof(deps.hmac, key, msg.nonce, clientNonce);
      if (link !== l) return;
      Object.assign(l, { phase: "welcome", key, pairing, hubNonce: msg.nonce, clientNonce });
      const hello: Envelope = pairing
        ? { t: "hello-plugin", nonce: clientNonce, proof, pair: true, fileName }
        : { t: "hello-plugin", nonce: clientNonce, proof, fileName };
      l.socket.send(JSON.stringify(hello));
      return;
    }
    if (l.phase === "welcome") {
      if (msg?.t === "denied") {
        // `denied` is unauthenticated, so it proves nothing about the server. A code may also be refused
        // only because the hub throttles attempts. Keep the wording neutral and never prompt on our own.
        if (l.pairing) {
          code = undefined;
          return halt(l, "needs-code", "Code not accepted. Wait a moment and try again.");
        }
        return halt(l, "rejected");
      }
      if (msg?.t !== "welcome" || typeof msg.proof !== "string") return l.socket.close();
      const expected = await hubProof(deps.hmac, l.key!, l.clientNonce!, l.hubNonce!);
      if (link !== l) return;
      // Verify the hub before trusting anything in the welcome, including the new secret.
      if (!sameProof(msg.proof, expected)) {
        code = undefined;
        return halt(l, "untrusted");
      }
      if (l.pairing) {
        if (typeof msg.secret !== "string" || !msg.secret) return halt(l, "untrusted");
        secret = msg.secret;
        code = undefined;
        deps.toMain({ type: "save-secret", secret });
      }
      l.phase = "ready";
      return setStatus("connected");
    }
    if (msg?.t !== "cmd" || !isObj(msg.cmd) || typeof msg.cmd.id !== "string") return;
    const cmd = msg.cmd;
    const name = typeof cmd.name === "string" ? cmd.name : "?";
    const expected = await deps.hmac(secret!, cmdSigPayload(cmd));
    if (link !== l) return;
    if (typeof msg.sig !== "string" || !sameProof(msg.sig, expected) || !validCmd(cmd)) {
      const res: Result = { id: cmd.id, ok: false, code: "AUTH_FAILED", message: "Bad command signature" };
      l.socket.send(JSON.stringify({ t: "res", res } satisfies Envelope));
      return addLog({ id: cmd.id, name, state: "error", detail: "Rejected: bad signature" });
    }
    addLog({ id: cmd.id, name, state: "running" });
    deps.toMain({ type: "cmd", cmd });
  }

  function onClose(l: Link, closeCode?: number) {
    if (link !== l) return;
    link = null;
    declineAll();
    if (closeCode === REPLACED_CLOSE_CODE) return setStatus("replaced");
    if (!secret && !code) return setStatus("needs-code");
    setStatus("disconnected");
    timer = deps.setTimer(() => {
      timer = null;
      connect();
    }, RECONNECT_MS);
  }

  return {
    // From the main thread's `init`: the stored secret (if any) and the current file name.
    init(storedSecret: string | undefined, name: string) {
      secret = storedSecret || undefined;
      fileName = name;
      connect();
    },
    // User typed a pairing code. Takes precedence over a stored secret until the hub accepts it.
    pair(input: string) {
      const c = input.trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(c)) return setStatus("needs-code", "The pairing code has 6 letters or digits.");
      code = c;
      connect();
    },
    // User chose Pair again after `rejected`: show the code input. The stored secret stays until a pairing replaces it.
    pairAgain() {
      if (status === "rejected") setStatus("needs-code");
    },
    unpair() {
      secret = undefined;
      code = undefined;
      stopTimer();
      drop();
      deps.toMain({ type: "unpair" });
      setStatus("needs-code");
    },
    // A result from the main thread for a command this client forwarded.
    fromMain(res: Result) {
      const entry = log.find((e) => e.id === res.id);
      if (entry) addLog({ ...entry, state: res.ok ? "ok" : "error", detail: res.ok ? undefined : res.code });
      if (link?.phase === "ready") link.socket.send(JSON.stringify({ t: "res", res } satisfies Envelope));
    },
    // ctx.confirm from the main thread. Declined at once when no ready link exists.
    confirmRequest(id: number, summary: string) {
      if (link?.phase !== "ready") return deps.toMain({ type: "confirm-reply", id, ok: false });
      confirms.push({ id, summary });
      deps.onChange(view());
    },
    // The main thread expired this confirm; hide it without replying.
    confirmCancel(id: number) {
      confirms = confirms.filter((c) => c.id !== id);
      deps.onChange(view());
    },
    // User clicked Approve or Decline on the confirm shown now.
    answerConfirm(ok: boolean) {
      const c = confirms.shift();
      if (!c) return;
      deps.toMain({ type: "confirm-reply", id: c.id, ok });
      deps.onChange(view());
    },
    view,
    // Resolves once every socket event received so far has been handled (for tests).
    settled: () => chain,
  };
}

export type Client = ReturnType<typeof createClient>;
