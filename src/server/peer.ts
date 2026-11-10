import { randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";
import { CONFIRM_TIMEOUT_MS, PORT, REQUEST_TIMEOUT_MS, type Result } from "../shared/protocol.ts";
import { notConnected, parseEnvelope, startHub, timedOut, type Bridge, type BridgeStatus, type Timeouts } from "./hub.ts";
import { clientProof, cmdSigPayload, hubProof } from "../shared/handshake.ts";
import { safeEqual, sign, type SecretStore } from "./pairing.ts";

export type { Bridge, BridgeStatus } from "./hub.ts";

const HANDSHAKE_TIMEOUT_MS = 2_000;
const RETRY_MS = 250;
const RENEW_WAIT_MS = 2_000;

// Connects to a running hub as a peer. Resolves once the hub proves it knows the server secret.
async function connectPeer(opts: {
  port: number;
  host: string;
  store: SecretStore;
  timeouts: Timeouts;
  onLost(): void;
}): Promise<Bridge> {
  const secrets = await opts.store.load();
  if (!secrets?.server) throw new Error("Hub has not written the server secret yet");
  const secret = secrets.server;
  const ws = new WebSocket(`ws://${opts.host}:${opts.port}`, { handshakeTimeout: HANDSHAKE_TIMEOUT_MS });
  ws.on("error", () => {});

  let state: Omit<BridgeStatus, "role"> = { pluginConnected: false };
  let closing = false;
  // Waiters for the next state frame (renewPairingCode).
  let onState: (() => void)[] = [];
  const pending = new Map<string, { timer: NodeJS.Timeout; resolve(r: Result): void }>();
  const settle = (id: string, r: Result) => {
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(id);
    p.resolve(r);
  };

  // One listener from the start: welcome and the first state frame can arrive in the same chunk,
  // so the expected hub proof is computed before the hello goes out and checked synchronously.
  const clientNonce = randomBytes(16).toString("hex");
  let expected: string | undefined;
  let welcomed = false;
  let onStep: (e: Error | "welcome") => void = () => {};
  ws.on("message", (raw) => {
    const msg = parseEnvelope(raw);
    if (!welcomed) {
      if (msg?.t === "challenge" && expected === undefined) {
        const hubNonce = msg.nonce;
        void Promise.all([
          clientProof(sign, secret, hubNonce, clientNonce),
          hubProof(sign, secret, clientNonce, hubNonce),
        ]).then(([proof, hub]) => {
          expected = hub;
          ws.send(JSON.stringify({ t: "hello-peer", nonce: clientNonce, proof }));
        });
        return;
      }
      welcomed = msg?.t === "welcome" && expected !== undefined && safeEqual(msg.proof, expected);
      return onStep(welcomed ? "welcome" : new Error("Hub denied the peer or failed to prove the secret"));
    }
    if (msg?.t === "state") {
      const { t: _t, ...rest } = msg;
      state = rest;
      for (const w of onState.splice(0)) w();
    } else if (msg?.t === "res") settle(msg.res.id, msg.res);
  });

  await new Promise<void>((resolve, reject) => {
    const fail = (e: Error) => {
      clearTimeout(timer);
      ws.off("close", onEarlyClose);
      ws.terminate();
      reject(e);
    };
    const onEarlyClose = () => fail(new Error("Hub closed the connection during handshake"));
    const timer = setTimeout(() => fail(new Error("Hub handshake timed out")), HANDSHAKE_TIMEOUT_MS);
    ws.once("close", onEarlyClose);
    onStep = (step) => {
      if (step instanceof Error) return fail(step);
      clearTimeout(timer);
      ws.off("close", onEarlyClose);
      resolve();
    };
  });

  const lost = new Promise<void>((resolve) =>
    ws.once("close", () => {
      state = { pluginConnected: false };
      for (const w of onState.splice(0)) w();
      for (const id of [...pending.keys()]) settle(id, notConnected(id, "Lost connection to the bridge hub before a reply"));
      resolve();
      if (!closing) opts.onLost();
    }),
  );

  return {
    send(name, args, sendOpts) {
      const id = randomUUID();
      if (ws.readyState !== WebSocket.OPEN) return Promise.resolve(notConnected(id));
      const ms = sendOpts?.confirm ? opts.timeouts.confirm : opts.timeouts.request;
      return new Promise((resolve) => {
        const timer = setTimeout(() => settle(id, timedOut(id, ms)), ms);
        pending.set(id, { timer, resolve });
        const cmd = { id, name, args };
        ws.send(JSON.stringify({ t: "cmd", sig: sign(secret, cmdSigPayload(cmd)), cmd }));
      });
    },
    status() {
      return { role: "peer", ...state };
    },
    renewPairingCode() {
      if (ws.readyState !== WebSocket.OPEN) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const timer = setTimeout(done, RENEW_WAIT_MS);
        function done() {
          clearTimeout(timer);
          onState = onState.filter((w) => w !== done);
          resolve();
        }
        onState.push(done);
        ws.send(JSON.stringify({ t: "renew-code" }));
      });
    },
    async close() {
      closing = true;
      ws.terminate();
      await lost;
    },
  };
}

// State machine: hub (we own the port) | peer (connected to the hub) | between (retrying).
// A peer whose hub connection drops retries every RETRY_MS: listen first (take over), else reconnect.
export async function startBridge(opts: {
  port?: number;
  store: SecretStore;
  host?: "127.0.0.1";
  timeouts?: Timeouts;
  pairIntervalMs?: number;
}): Promise<Bridge> {
  const port = opts.port ?? PORT;
  const host = opts.host ?? "127.0.0.1";
  const timeouts = opts.timeouts ?? { request: REQUEST_TIMEOUT_MS, confirm: CONFIRM_TIMEOUT_MS };
  let current: Bridge | null = null;
  let closed = false;
  let retry: NodeJS.Timeout | undefined;

  const hub = () => startHub({ port, host, store: opts.store, timeouts, pairIntervalMs: opts.pairIntervalMs });
  const peer = () => connectPeer({ port, host, store: opts.store, timeouts, onLost });
  const isInUse = (e: unknown) => (e as NodeJS.ErrnoException).code === "EADDRINUSE";

  async function attempt(): Promise<Bridge> {
    try {
      return await hub();
    } catch (e) {
      if (!isInUse(e)) throw e;
    }
    return peer();
  }

  function onLost() {
    current = null;
    schedule(Math.floor(Math.random() * 100));
  }

  function schedule(ms: number) {
    if (closed) return;
    retry = setTimeout(() => {
      attempt().then(
        (b) => {
          if (closed) return void b.close();
          current = b;
        },
        () => schedule(RETRY_MS),
      );
    }, ms);
  }

  // Surface a corrupt pairing file now instead of retrying on it forever.
  await opts.store.load();
  try {
    current = await hub();
  } catch (e) {
    if (!isInUse(e)) throw e;
    // The hub may be mid-shutdown or not ready yet: become a peer in the background.
    await peer().then((b) => (current = b), () => schedule(RETRY_MS));
  }

  return {
    send(name, args, sendOpts) {
      return current ? current.send(name, args, sendOpts) : Promise.resolve(notConnected(randomUUID()));
    },
    status() {
      return current ? current.status() : { role: "peer", pluginConnected: false };
    },
    async renewPairingCode() {
      await current?.renewPairingCode();
    },
    async close() {
      closed = true;
      clearTimeout(retry);
      await current?.close();
      current = null;
    },
  };
}
