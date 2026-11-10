import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import type { Envelope } from "../../src/shared/protocol.ts";
import { clientProof, cmdSigPayload, hubProof, sameProof } from "../../src/shared/handshake.ts";
import { sign, type SecretStore, type Secrets } from "../../src/server/pairing.ts";
import { PAIR_INTERVAL_MS } from "../../src/server/hub.ts";
import { startBridge, type Bridge } from "../../src/server/peer.ts";

const HOST = "127.0.0.1";
const fast = { request: 50, confirm: 200 };

// `hold()` makes the next save wait until the returned release function is called.
function memoryStore(initial: Secrets | null = null) {
  let gate: Promise<void> | undefined;
  const s = {
    data: initial,
    saves: 0,
    hold() {
      let release!: () => void;
      gate = new Promise((r) => (release = r));
      return () => release();
    },
    async load() {
      return s.data ? { ...s.data } : null;
    },
    async save(v: Secrets) {
      const g = gate;
      gate = undefined;
      s.saves++;
      if (g) await g;
      s.data = { ...v };
    },
    async clearPlugin() {
      if (s.data) s.data = { server: s.data.server };
    },
  };
  return s;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, HOST, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

const bridges: Bridge[] = [];
const sockets: WebSocket[] = [];
const servers: WebSocketServer[] = [];
const cleanups: (() => void)[] = [];

// Pair throttling is off by default here so tests can make quick attempts; pass PAIR_INTERVAL_MS for the real one.
async function bridge(
  port: number,
  store: SecretStore,
  timeouts = fast,
  pairIntervalMs = 0,
): Promise<Bridge> {
  const b = await startBridge({ port, store, host: HOST, timeouts, pairIntervalMs });
  bridges.push(b);
  return b;
}

afterEach(async () => {
  for (const c of cleanups.splice(0)) c();
  for (const s of sockets.splice(0)) s.terminate();
  await Promise.all(bridges.splice(0).map((b) => b.close()));
  await Promise.all(
    servers.splice(0).map((w) => {
      for (const c of w.clients) c.terminate();
      return new Promise((r) => w.close(r));
    }),
  );
});

type Client = { ws: WebSocket; next(): Promise<Envelope>; closed: Promise<void>; send(e: unknown): void };

function connect(port: number, origin?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${port}`, origin === undefined ? {} : { origin });
    sockets.push(ws);
    const queue: Envelope[] = [];
    const waiters: ((e: Envelope) => void)[] = [];
    ws.on("message", (raw) => {
      const e = JSON.parse(String(raw)) as Envelope;
      const w = waiters.shift();
      if (w) w(e);
      else queue.push(e);
    });
    const closed = new Promise<void>((r) => ws.once("close", () => r()));
    const client: Client = {
      ws,
      closed,
      next: () => {
        const e = queue.shift();
        return e ? Promise.resolve(e) : new Promise((r) => waiters.push(r));
      },
      send: (e) => ws.send(JSON.stringify(e)),
    };
    ws.once("open", () => resolve(client));
    ws.once("error", reject);
  });
}

async function nextOf<T extends Envelope["t"]>(c: Client, t: T): Promise<Extract<Envelope, { t: T }>> {
  for (;;) {
    const e = await c.next();
    if (e.t === t) return e as Extract<Envelope, { t: T }>;
  }
}

// Fake plugin handshake built on the shared helpers, the way the plugin UI will do it.
// `key` is the pairing code when pair is true, else the stored plugin secret.
type HelloResult = { ok: true; secret?: string } | { ok: false; why: "denied" | "bad hub proof" };
async function pluginHello(c: Client, key: string, opts: { pair?: boolean; fileName?: string } = {}): Promise<HelloResult> {
  const { nonce: hubNonce } = await nextOf(c, "challenge");
  const nonce = randomBytes(16).toString("hex");
  c.send({ t: "hello-plugin", nonce, proof: await clientProof(sign, key, hubNonce, nonce), ...opts });
  const e = await c.next();
  if (e.t !== "welcome") return { ok: false, why: "denied" };
  if (!sameProof(e.proof, await hubProof(sign, key, nonce, hubNonce))) {
    c.ws.close();
    return { ok: false, why: "bad hub proof" };
  }
  return e.secret === undefined ? { ok: true } : { ok: true, secret: e.secret };
}

async function peerHello(c: Client, secret: string): Promise<Envelope> {
  const { nonce: hubNonce } = await nextOf(c, "challenge");
  const nonce = randomBytes(16).toString("hex");
  c.send({ t: "hello-peer", nonce, proof: await clientProof(sign, secret, hubNonce, nonce) });
  return c.next();
}

// Fake plugin: verifies the hub's signature and echoes the command back.
function serve(c: Client, secret: string) {
  c.ws.on("message", (raw) => {
    const e = JSON.parse(String(raw)) as Envelope;
    if (e.t !== "cmd") return;
    const good = e.sig === sign(secret, cmdSigPayload(e.cmd));
    const res = good
      ? { id: e.cmd.id, ok: true, data: { echo: e.cmd.name, args: e.cmd.args } }
      : { id: e.cmd.id, ok: false, code: "AUTH_FAILED", message: "bad sig" };
    c.send({ t: "res", res });
  });
}

async function pair(port: number, b: Bridge, fileName?: string): Promise<{ client: Client; secret: string }> {
  const code = b.status().pairingCode;
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  const client = await connect(port);
  const r = await pluginHello(client, code!, { pair: true, ...(fileName ? { fileName } : {}) });
  expect(r.ok && r.secret).toBeTruthy();
  return { client, secret: (r as { secret: string }).secret };
}

const waitFor = async (cond: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

const otherCode = (code: string) => (code === "AAAAAA" ? "BBBBBB" : "AAAAAA");

describe("hub", () => {
  it("pairs with code then reconnects with secret", async () => {
    const port = await freePort();
    const store = memoryStore();
    const b = await bridge(port, store);
    expect(b.status()).toMatchObject({ role: "hub", pluginConnected: false });
    expect(store.data?.server).toBeTruthy();

    const { client, secret } = await pair(port, b);
    expect(store.data?.plugin).toBe(secret);
    expect(b.status().pairingCode).toBeUndefined();
    await waitFor(() => b.status().pluginConnected, 1000);

    serve(client, secret);
    const r = await b.send("status", { x: 1 });
    expect(r).toMatchObject({ ok: true, data: { echo: "status", args: { x: 1 } } });

    client.ws.close();
    await client.closed;
    await waitFor(() => !b.status().pluginConnected, 1000);

    const again = await connect(port);
    expect(await pluginHello(again, secret, { fileName: "Design file" })).toEqual({ ok: true });
    serve(again, secret);
    expect(await b.send("read_selection", {})).toMatchObject({ ok: true });
    await waitFor(() => b.status().fileName === "Design file", 1000);

    again.ws.close();
    await waitFor(() => !b.status().pluginConnected, 1000);
    expect(b.status().fileName).toBeUndefined();
  });

  it("offers a code whenever no plugin is connected; code pairing replaces the stored secret", async () => {
    const port = await freePort();
    const store = memoryStore({ server: "srv-secret", plugin: "old-plugin-secret" });
    const b = await bridge(port, store);
    expect(b.status().pairingCode).toMatch(/^[A-Z2-9]{6}$/);

    const { client, secret } = await pair(port, b);
    expect(secret).not.toBe("old-plugin-secret");
    expect(store.data).toEqual({ server: "srv-secret", plugin: secret });

    client.ws.close();
    await waitFor(() => b.status().pairingCode !== undefined, 1000);

    const stale = await connect(port);
    expect(await pluginHello(stale, "old-plugin-secret")).toEqual({ ok: false, why: "denied" });
  });

  it("rejects wrong code and unsigned cmd", async () => {
    const port = await freePort();
    const store = memoryStore();
    const b = await bridge(port, store);
    const code = b.status().pairingCode!;

    const wrong = await connect(port);
    expect(await pluginHello(wrong, otherCode(code), { pair: true })).toEqual({ ok: false, why: "denied" });
    await wrong.closed;

    const badSecret = await connect(port);
    expect(await pluginHello(badSecret, "nope")).toEqual({ ok: false, why: "denied" });

    // A proof made for another challenge (replay) is refused.
    const replay = await connect(port);
    await nextOf(replay, "challenge");
    const nonce = randomBytes(16).toString("hex");
    replay.send({ t: "hello-peer", nonce, proof: sign(store.data!.server, `client:${"0".repeat(32)}${nonce}`) });
    expect(await nextOf(replay, "denied")).toEqual({ t: "denied", code: "AUTH_FAILED" });

    const unsigned = await connect(port);
    unsigned.send({ t: "cmd", sig: "", cmd: { id: "1", name: "delete_nodes", args: {} } });
    expect(await nextOf(unsigned, "denied")).toEqual({ t: "denied", code: "AUTH_FAILED" });
    await unsigned.closed;

    const badPeer = await connect(port);
    expect(await peerHello(badPeer, "wrong")).toEqual({ t: "denied", code: "AUTH_FAILED" });

    const peer = await connect(port);
    expect((await peerHello(peer, store.data!.server)).t).toBe("welcome");
    peer.send({ t: "cmd", sig: "bad", cmd: { id: "p1", name: "status", args: {} } });
    expect((await nextOf(peer, "res")).res).toMatchObject({ id: "p1", ok: false, code: "AUTH_FAILED" });

    // Args changed after signing: the signature covers id, name and args.
    const peer2 = await connect(port);
    expect((await peerHello(peer2, store.data!.server)).t).toBe("welcome");
    const signed = { id: "p2", name: "delete_nodes" as const, args: { ids: ["1:2"] } };
    const sig = sign(store.data!.server, cmdSigPayload(signed));
    peer2.send({ t: "cmd", sig, cmd: { ...signed, args: { ids: ["1:2", "9:9"] } } });
    expect((await nextOf(peer2, "res")).res).toMatchObject({ id: "p2", ok: false, code: "AUTH_FAILED" });

    expect(store.data?.plugin).toBeUndefined();
  });

  it("rotates the pairing code after 5 failed attempts", async () => {
    const port = await freePort();
    const b = await bridge(port, memoryStore());
    const first = b.status().pairingCode!;
    for (let i = 0; i < 5; i++) {
      const c = await connect(port);
      expect(await pluginHello(c, otherCode(first), { pair: true })).toEqual({ ok: false, why: "denied" });
    }
    const second = b.status().pairingCode!;
    expect(second).not.toBe(first);

    const stale = await connect(port);
    expect(await pluginHello(stale, first, { pair: true })).toEqual({ ok: false, why: "denied" });
  });

  it("rejects foreign Origin", async () => {
    const port = await freePort();
    await bridge(port, memoryStore());
    await expect(connect(port, "https://evil.example")).rejects.toThrow(/403/);
    const ok = await connect(port, "null");
    expect(ok.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("no plugin -> PLUGIN_NOT_CONNECTED within 100 ms", async () => {
    const port = await freePort();
    const b = await bridge(port, memoryStore(), { request: 30_000, confirm: 120_000 });
    const t0 = Date.now();
    const r = await b.send("read_selection", {});
    expect(Date.now() - t0).toBeLessThan(100);
    expect(r).toMatchObject({
      ok: false,
      code: "PLUGIN_NOT_CONNECTED",
      message: "Figma plugin is not connected",
      hint: "Open Figma desktop, run Plugins > Development > figma-starter",
    });
  });

  it("request timeout -> TIMEOUT, confirm uses the longer timeout", async () => {
    const port = await freePort();
    const b = await bridge(port, memoryStore());
    await pair(port, b);
    await waitFor(() => b.status().pluginConnected, 1000);

    const t0 = Date.now();
    expect(await b.send("read_page", {})).toMatchObject({ ok: false, code: "TIMEOUT" });
    const normal = Date.now() - t0;
    expect(normal).toBeGreaterThanOrEqual(45);
    expect(normal).toBeLessThan(180);

    const t1 = Date.now();
    expect(await b.send("delete_nodes", {}, { confirm: true })).toMatchObject({ ok: false, code: "TIMEOUT" });
    expect(Date.now() - t1).toBeGreaterThanOrEqual(190);
  });
});

describe("pairing limits", () => {
  it("throttles a burst of pair attempts hub-wide without checking the code", async () => {
    const port = await freePort();
    const store = memoryStore();
    expect(PAIR_INTERVAL_MS).toBe(500);
    const b = await bridge(port, store, fast, PAIR_INTERVAL_MS);
    const code = b.status().pairingCode!;

    // Six wrong guesses at once: only the first is checked, so the code does not rotate.
    const burst = await Promise.all(Array.from({ length: 6 }, () => connect(port)));
    const results = await Promise.all(burst.map((c) => pluginHello(c, otherCode(code), { pair: true })));
    expect(results.every((r) => !r.ok)).toBe(true);

    // Even the right code is refused inside the window...
    const early = await connect(port);
    expect(await pluginHello(early, code, { pair: true })).toEqual({ ok: false, why: "denied" });
    expect(b.status().pairingCode).toBe(code);
    expect(store.data?.plugin).toBeUndefined();

    // ...and accepted once the window has passed.
    await new Promise((r) => setTimeout(r, 550));
    const late = await connect(port);
    expect((await pluginHello(late, code, { pair: true })).ok).toBe(true);
  });

  it("caps concurrent unauthenticated sockets", async () => {
    const port = await freePort();
    await bridge(port, memoryStore());
    const idle = await Promise.all(Array.from({ length: 8 }, () => connect(port)));
    const extra = await connect(port);
    await extra.closed;
    expect(idle.every((c) => c.ws.readyState === WebSocket.OPEN)).toBe(true);

    idle[0].ws.close();
    await idle[0].closed;
    await new Promise((r) => setTimeout(r, 50));
    const again = await connect(port);
    expect((await again.next()).t).toBe("challenge");
  });

  it("stops offering a code after 3 rotations until renewPairingCode()", async () => {
    const port = await freePort();
    const store = memoryStore();
    const hub = await bridge(port, store);
    const peer = await bridge(port, store);
    for (let i = 0; i < 15; i++) {
      const code = hub.status().pairingCode;
      expect(code).toBeDefined();
      const c = await connect(port);
      expect(await pluginHello(c, otherCode(code!), { pair: true })).toEqual({ ok: false, why: "denied" });
    }
    expect(hub.status().pairingCode).toBeUndefined();
    await waitFor(() => peer.status().pairingCode === undefined, 1000);

    peer.renewPairingCode();
    await waitFor(() => hub.status().pairingCode !== undefined, 1000);
    await waitFor(() => peer.status().pairingCode === hub.status().pairingCode, 1000);

    hub.renewPairingCode();
    const fresh = hub.status().pairingCode!;
    await pair(port, hub);
    expect(fresh).toBeDefined();
  });

  it("renew keeps an unused code; a peer's awaited renew shows the code the hub accepts", async () => {
    const port = await freePort();
    const store = memoryStore();
    const hub = await bridge(port, store);
    const peer = await bridge(port, store);
    await waitFor(() => peer.status().pairingCode === hub.status().pairingCode, 1000);
    const offered = hub.status().pairingCode!;
    await peer.renewPairingCode();
    expect(hub.status().pairingCode).toBe(offered);
    expect(peer.status().pairingCode).toBe(offered);

    // Exhaust the rotations so no code is offered, then renew from the peer: the code the peer
    // reports as soon as renew resolves is the one the hub accepts.
    for (let i = 0; i < 15; i++) {
      const c = await connect(port);
      await pluginHello(c, otherCode(hub.status().pairingCode!), { pair: true });
    }
    await waitFor(() => peer.status().pairingCode === undefined, 1000);
    await peer.renewPairingCode();
    const shown = peer.status().pairingCode;
    expect(shown).toBeDefined();
    expect(shown).toBe(hub.status().pairingCode);
    const c = await connect(port);
    expect((await pluginHello(c, shown!, { pair: true })).ok).toBe(true);
  });

  it("does not replace the secret if a plugin connected while the pairing was saving", async () => {
    const port = await freePort();
    const store = memoryStore({ server: "srv", plugin: "old-secret" });
    const b = await bridge(port, store);
    const code = b.status().pairingCode!;

    const release = store.hold();
    const pairing = await connect(port);
    const paired = pluginHello(pairing, code, { pair: true });
    await waitFor(() => store.saves === 1, 1000);

    const old = await connect(port);
    expect(await pluginHello(old, "old-secret")).toEqual({ ok: true });
    serve(old, "old-secret");
    await waitFor(() => b.status().pluginConnected, 1000);

    release();
    expect(await paired).toEqual({ ok: false, why: "denied" });
    await waitFor(() => store.saves === 2, 1000);
    expect(store.data).toEqual({ server: "srv", plugin: "old-secret" });
    expect(await b.send("status", {})).toMatchObject({ ok: true });
  });

  it("does not replace the secret if the pairing socket closed while saving", async () => {
    const port = await freePort();
    const store = memoryStore({ server: "srv", plugin: "old-secret" });
    const b = await bridge(port, store);
    const code = b.status().pairingCode!;

    const release = store.hold();
    const pairing = await connect(port);
    const { nonce: hubNonce } = await nextOf(pairing, "challenge");
    const nonce = randomBytes(16).toString("hex");
    pairing.send({ t: "hello-plugin", nonce, proof: await clientProof(sign, code, hubNonce, nonce), pair: true });
    await waitFor(() => store.saves === 1, 1000);
    pairing.ws.close();
    await pairing.closed;
    await new Promise((r) => setTimeout(r, 30));

    release();
    await waitFor(() => store.saves === 2, 1000);
    expect(store.data).toEqual({ server: "srv", plugin: "old-secret" });
    await waitFor(() => b.status().pairingCode !== undefined, 1000);
  });
});

describe("fake hub", () => {
  it("receives no secret from a peer or a paired plugin, and both reject its wrong proof", async () => {
    const port = await freePort();
    const fake = new WebSocketServer({ host: HOST, port });
    servers.push(fake);
    await new Promise((r) => fake.once("listening", r));
    const seen: string[] = [];
    let closedByClient = 0;
    fake.on("connection", (ws) => {
      ws.send(JSON.stringify({ t: "challenge", nonce: randomBytes(16).toString("hex") }));
      ws.on("message", (raw) => {
        seen.push(String(raw));
        ws.send(JSON.stringify({ t: "welcome", proof: "0".repeat(64) }));
        ws.send(JSON.stringify({ t: "state", pluginConnected: true }));
      });
      ws.on("close", () => closedByClient++);
    });

    const store = memoryStore({ server: "SERVER-SECRET-123", plugin: "PLUGIN-SECRET-456" });
    const peer = await bridge(port, store);
    expect(peer.status()).toEqual({ role: "peer", pluginConnected: false });
    await waitFor(() => seen.some((m) => m.includes("hello-peer")) && closedByClient > 0, 2000);
    expect((await peer.send("status", {})).ok).toBe(false);
    expect(peer.status().pluginConnected).toBe(false);

    const plugin = await connect(port);
    expect(await pluginHello(plugin, "PLUGIN-SECRET-456")).toEqual({ ok: false, why: "bad hub proof" });

    expect(seen.some((m) => m.includes("hello-plugin"))).toBe(true);
    expect(seen.join("\n")).not.toMatch(/SERVER-SECRET-123|PLUGIN-SECRET-456/);
    expect(seen.join("\n")).not.toMatch(/"t":"cmd"/);
  });
});

describe("peers and takeover", () => {
  it("second bridge becomes peer and routes through hub", async () => {
    const port = await freePort();
    const store = memoryStore();
    const hub = await bridge(port, store);
    const peer = await bridge(port, store);
    expect(peer.status().role).toBe("peer");

    // Peer sees the hub's pairing code so either session can show it.
    await waitFor(() => peer.status().pairingCode === hub.status().pairingCode, 1000);

    const t0 = Date.now();
    expect(await peer.send("status", {})).toMatchObject({ ok: false, code: "PLUGIN_NOT_CONNECTED" });
    expect(Date.now() - t0).toBeLessThan(100);

    const { client, secret } = await pair(port, hub, "Design file");
    serve(client, secret);
    await waitFor(() => peer.status().pluginConnected, 1000);
    expect(peer.status()).toEqual({ role: "peer", pluginConnected: true, fileName: "Design file" });

    const [a, c] = await Promise.all([peer.send("create_frame", { n: 1 }), hub.send("rename", { n: 2 })]);
    expect(a).toMatchObject({ ok: true, data: { echo: "create_frame", args: { n: 1 } } });
    expect(c).toMatchObject({ ok: true, data: { echo: "rename", args: { n: 2 } } });
  });

  it("peer request times out when the plugin does not answer", async () => {
    const port = await freePort();
    const store = memoryStore();
    const hub = await bridge(port, store);
    const peer = await bridge(port, store);
    await pair(port, hub);
    await waitFor(() => peer.status().pluginConnected, 1000);
    expect(await peer.send("read_page", {})).toMatchObject({ ok: false, code: "TIMEOUT" });
  });

  it("hub closes -> peer takes over within 3 s and plugin reconnects with stored secret", async () => {
    const port = await freePort();
    const store = memoryStore();
    const first = await bridge(port, store);
    const second = await bridge(port, store);
    expect(second.status().role).toBe("peer");

    const { client, secret } = await pair(port, first);

    // Fake plugin: on close, keep reconnecting with the stored secret, like the plugin UI does.
    let stopped = false;
    cleanups.push(() => {
      stopped = true;
    });
    let reconnected = false;
    const reconnect = async () => {
      while (!stopped) {
        try {
          const c = await connect(port);
          if ((await pluginHello(c, secret)).ok) {
            serve(c, secret);
            reconnected = true;
            return;
          }
        } catch {
          // hub not up yet
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    };
    client.ws.once("close", () => void reconnect());

    const t0 = Date.now();
    await first.close();
    // `reconnected` flips after the fake plugin verified the new hub's proof and attached its handler.
    await waitFor(() => reconnected && second.status().role === "hub" && second.status().pluginConnected, 3000);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(second.status().pairingCode).toBeUndefined();
    expect(store.data?.plugin).toBe(secret);
    expect(await second.send("status", {})).toMatchObject({ ok: true, data: { echo: "status" } });
  });
});
