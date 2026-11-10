import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import {
  COMMANDS,
  type Command,
  type CommandName,
  type Envelope,
  type Result,
} from "../shared/protocol.ts";
import { clientProof, cmdSigPayload, hubProof, validNonce } from "../shared/handshake.ts";
import { newPairingCode, newSecret, safeEqual, sign, type SecretStore, type Secrets } from "./pairing.ts";

export interface Bridge {
  send(name: CommandName, args: unknown, opts?: { confirm?: boolean }): Promise<Result>;
  status(): BridgeStatus;
  // Lifts the rotation limit and, if no plugin is connected and no code is offered, issues a fresh code.
  // An unused code is kept. Resolves once status() shows the code the hub accepts.
  renewPairingCode(): Promise<void>;
  close(): Promise<void>;
}
export type BridgeStatus = { role: "hub" | "peer"; pluginConnected: boolean; pairingCode?: string; fileName?: string };
export type Timeouts = { request: number; confirm: number };

const MAX_CODE_FAILURES = 5; // wrong codes before the code rotates
const MAX_ROTATIONS = 3; // rotations before no code is offered until renewPairingCode()
export const PAIR_INTERVAL_MS = 500; // hub-wide: at most one code check per interval
const MAX_UNAUTHENTICATED = 8; // concurrent sockets that have not finished the handshake
const HELLO_TIMEOUT_MS = 5_000;

export function notConnected(id: string, message = "Figma plugin is not connected"): Result {
  return {
    id,
    ok: false,
    code: "PLUGIN_NOT_CONNECTED",
    message,
    hint: "Open Figma desktop, run Plugins > Development > figma-starter",
  };
}

export function timedOut(id: string, ms: number): Result {
  return {
    id,
    ok: false,
    code: "TIMEOUT",
    message: `No reply from the Figma plugin within ${ms / 1000} s`,
    hint: "Check the plugin window in Figma; the command may still have run",
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const optStr = (v: unknown) => v === undefined || typeof v === "string";

// Boundary check for every frame read from a socket. Returns null for anything malformed.
export function parseEnvelope(raw: WebSocket.RawData): Envelope | null {
  let v: unknown;
  try {
    v = JSON.parse(String(raw));
  } catch {
    return null;
  }
  if (!isObj(v)) return null;
  switch (v.t) {
    case "challenge":
      return typeof v.nonce === "string" ? (v as Envelope) : null;
    case "hello-plugin":
      return validNonce(v.nonce) &&
        typeof v.proof === "string" &&
        (v.pair === undefined || typeof v.pair === "boolean") &&
        optStr(v.fileName)
        ? (v as Envelope)
        : null;
    case "hello-peer":
      return validNonce(v.nonce) && typeof v.proof === "string" ? (v as Envelope) : null;
    case "renew-code":
      return v as Envelope;
    case "welcome":
      return typeof v.proof === "string" && optStr(v.secret) ? (v as Envelope) : null;
    case "state":
      return typeof v.pluginConnected === "boolean" && optStr(v.pairingCode) && optStr(v.fileName)
        ? (v as Envelope)
        : null;
    case "denied":
      return typeof v.code === "string" ? (v as Envelope) : null;
    case "cmd":
      return typeof v.sig === "string" &&
        isObj(v.cmd) &&
        typeof v.cmd.id === "string" &&
        (COMMANDS as readonly unknown[]).includes(v.cmd.name)
        ? (v as Envelope)
        : null;
    case "res":
      return isObj(v.res) && typeof v.res.id === "string" && typeof v.res.ok === "boolean" ? (v as Envelope) : null;
  }
  return null;
}

const out = (ws: WebSocket, e: Envelope) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e));
};

type Pending = { plugin: WebSocket; peer?: WebSocket; timer: NodeJS.Timeout; done(r: Result): void };

// Binds host:port and serves as the hub. Rejects with the listen error (EADDRINUSE when another hub runs).
export async function startHub(opts: {
  port: number;
  host: string;
  store: SecretStore;
  timeouts: Timeouts;
  pairIntervalMs?: number;
}): Promise<Bridge> {
  const { store, timeouts } = opts;
  const pairIntervalMs = opts.pairIntervalMs ?? PAIR_INTERVAL_MS;
  const wss = new WebSocketServer({ noServer: true });
  const server = createServer((_req, res) => res.writeHead(426).end());

  let secrets: Secrets = { server: "" };
  // A pairing code exists exactly while no plugin is connected.
  let code: string | undefined;
  let codeFailures = 0;
  let rotations = 0;
  let lastPairCheck = -Infinity;
  let unauthenticated = 0;
  let plugin: WebSocket | null = null;
  let fileName: string | undefined;
  let closed = false;
  const peers = new Set<WebSocket>();
  const pending = new Map<string, Pending>();

  const snapshot = () => ({
    pluginConnected: plugin !== null,
    ...(code === undefined ? {} : { pairingCode: code }),
    ...(fileName === undefined ? {} : { fileName }),
  });
  const stateFor = (): Envelope => ({ t: "state", ...snapshot() });
  const broadcastState = () => {
    const e = stateFor();
    for (const p of peers) out(p, e);
  };
  const deny = (ws: WebSocket) => {
    out(ws, { t: "denied", code: "AUTH_FAILED" });
    ws.close(4001, "denied");
  };
  const settle = (id: string, r: Result) => {
    const entry = pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(id);
    entry.done(r);
  };

  function dispatch(cmd: Command, ms: number, done: (r: Result) => void, peer?: WebSocket) {
    const p = plugin!;
    const timer = setTimeout(() => settle(cmd.id, timedOut(cmd.id, ms)), ms);
    pending.set(cmd.id, { plugin: p, peer, timer, done });
    out(p, { t: "cmd", sig: sign(secrets.plugin!, cmdSigPayload(cmd)), cmd });
  }

  // Verifies a plugin hello. Returns the welcome to send, or null to deny.
  async function helloPlugin(
    ws: WebSocket,
    msg: Extract<Envelope, { t: "hello-plugin" }>,
    hubNonce: string,
  ): Promise<Envelope | null> {
    if (!msg.pair) {
      const key = secrets.plugin;
      if (!key || !safeEqual(msg.proof, await clientProof(sign, key, hubNonce, msg.nonce))) return null;
      return { t: "welcome", proof: await hubProof(sign, key, msg.nonce, hubNonce) };
    }
    const used = code;
    if (used === undefined) return null;
    // Throttle across all sockets; a throttled attempt is denied without checking the code.
    const now = Date.now();
    if (now - lastPairCheck < pairIntervalMs) return null;
    lastPairCheck = now;
    if (!safeEqual(msg.proof, await clientProof(sign, used, hubNonce, msg.nonce))) {
      if (code === used && ++codeFailures >= MAX_CODE_FAILURES) {
        codeFailures = 0;
        code = ++rotations >= MAX_ROTATIONS ? undefined : newPairingCode();
        broadcastState();
      }
      return null;
    }
    // Consume the code before awaiting so a concurrent hello cannot reuse it. Replaces any old plugin secret.
    code = undefined;
    codeFailures = 0;
    const next: Secrets = { server: secrets.server, plugin: newSecret() };
    try {
      await store.save(next);
    } catch {
      refreshCode();
      return null;
    }
    // A plugin may have authenticated with the stored secret, or this socket closed, during the save.
    // Then keep the old secret: put it back on disk and leave `secrets` untouched.
    if (plugin || ws.readyState !== WebSocket.OPEN) {
      await store.save(secrets).catch(() => {});
      refreshCode();
      return null;
    }
    secrets = next;
    return { t: "welcome", proof: await hubProof(sign, used, msg.nonce, hubNonce), secret: next.plugin };
  }

  function refreshCode() {
    if (plugin || code !== undefined || rotations >= MAX_ROTATIONS) return;
    code = newPairingCode();
    codeFailures = 0;
    broadcastState();
  }

  function adoptPlugin(ws: WebSocket, name: string | undefined) {
    const old = plugin;
    plugin = ws;
    fileName = name;
    code = undefined;
    if (old) old.close(4000, "replaced by a newer plugin connection");
    broadcastState();
  }

  function fromPeer(ws: WebSocket, msg: Extract<Envelope, { t: "cmd" }>) {
    const { cmd } = msg;
    const reply = (r: Result) => out(ws, { t: "res", res: r });
    if (!safeEqual(msg.sig, sign(secrets.server, cmdSigPayload(cmd)))) {
      reply({ id: cmd.id, ok: false, code: "AUTH_FAILED", message: "Bad command signature" });
      ws.close(4001, "bad signature");
      return;
    }
    if (!plugin) return reply(notConnected(cmd.id));
    if (pending.has(cmd.id)) {
      return reply({ id: cmd.id, ok: false, code: "INVALID_INPUT", message: "Duplicate command id" });
    }
    // The peer enforces its own (shorter or equal) timeout; this one only bounds the hub's bookkeeping.
    dispatch(cmd, timeouts.confirm, reply, ws);
  }

  async function helloPeer(msg: Extract<Envelope, { t: "hello-peer" }>, hubNonce: string): Promise<Envelope | null> {
    if (!safeEqual(msg.proof, await clientProof(sign, secrets.server, hubNonce, msg.nonce))) return null;
    return { t: "welcome", proof: await hubProof(sign, secrets.server, msg.nonce, hubNonce) };
  }

  // Always answers with a state frame so a waiting peer learns the current code.
  function renewCode() {
    rotations = 0;
    codeFailures = 0;
    if (!plugin && code === undefined) code = newPairingCode();
    broadcastState();
  }

  function onConnection(ws: WebSocket) {
    ws.on("error", () => {});
    if (unauthenticated >= MAX_UNAUTHENTICATED) return ws.close(1013, "too many pending connections");
    unauthenticated++;
    let role: "none" | "plugin" | "peer" = "none";
    let busy = false;
    const hubNonce = randomBytes(16).toString("hex");
    const helloTimer = setTimeout(() => ws.terminate(), HELLO_TIMEOUT_MS);
    out(ws, { t: "challenge", nonce: hubNonce });
    ws.on("message", (raw) => {
      const msg = parseEnvelope(raw);
      if (role === "none") {
        if (busy) return;
        if (msg?.t !== "hello-peer" && msg?.t !== "hello-plugin") return deny(ws);
        busy = true;
        const check = msg.t === "hello-peer" ? helloPeer(msg, hubNonce) : helloPlugin(ws, msg, hubNonce);
        void check.then((welcome) => {
          busy = false;
          if (!welcome) return deny(ws);
          if (ws.readyState !== WebSocket.OPEN) return refreshCode();
          clearTimeout(helloTimer);
          unauthenticated--;
          out(ws, welcome);
          if (msg.t === "hello-peer") {
            role = "peer";
            peers.add(ws);
            out(ws, stateFor());
          } else {
            role = "plugin";
            adoptPlugin(ws, msg.fileName);
          }
        });
        return;
      }
      if (role === "plugin" && msg?.t === "res") {
        const entry = pending.get(msg.res.id);
        if (entry && entry.plugin === ws) settle(msg.res.id, msg.res);
        return;
      }
      if (role === "peer" && msg?.t === "cmd") fromPeer(ws, msg);
      if (role === "peer" && msg?.t === "renew-code") renewCode();
    });
    ws.on("close", () => {
      clearTimeout(helloTimer);
      if (role === "none") unauthenticated--;
      if (role === "plugin") {
        for (const [id, e] of pending) {
          if (e.plugin === ws) settle(id, notConnected(id, "Figma plugin disconnected before replying"));
        }
        if (plugin === ws) {
          plugin = null;
          fileName = undefined;
          refreshCode();
        }
      }
      if (role === "peer") {
        peers.delete(ws);
        for (const [id, e] of pending) {
          if (e.peer === ws) {
            clearTimeout(e.timer);
            pending.delete(id);
          }
        }
      }
    });
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  // Only the process that won the port creates the server secret, so two starters cannot race on it.
  const ready = (async () => {
    const loaded = await store.load();
    secrets = loaded?.server ? loaded : { server: newSecret() };
    if (!loaded?.server) await store.save(secrets);
    code = newPairingCode();
  })();

  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => {});
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== "null") {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    ready.then(
      () => {
        if (closed) return socket.destroy();
        wss.handleUpgrade(req, socket, head, onConnection);
      },
      () => socket.destroy(),
    );
  });

  try {
    await ready;
  } catch (e) {
    await new Promise((r) => server.close(r));
    throw e;
  }

  return {
    send(name, args, sendOpts) {
      const id = randomUUID();
      if (closed || !plugin) return Promise.resolve(notConnected(id));
      const ms = sendOpts?.confirm ? timeouts.confirm : timeouts.request;
      return new Promise((resolve) => dispatch({ id, name, args }, ms, resolve));
    },
    status() {
      return { role: "hub", ...snapshot() };
    },
    async renewPairingCode() {
      renewCode();
    },
    async close() {
      if (closed) return;
      closed = true;
      // Free the port first so a waiting peer can take over as soon as its socket drops.
      const stopped = new Promise((r) => server.close(r));
      for (const id of [...pending.keys()]) settle(id, notConnected(id, "Bridge hub is shutting down"));
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await stopped;
    },
  };
}
