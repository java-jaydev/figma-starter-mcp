// UI iframe logic: handshake with the hub, command verification, reconnect. Uses Node's WebCrypto
// (the same API the iframe has) for HMAC, a fake socket for unit cases and the real hub for one end-to-end run.
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { clientProof, cmdSigPayload, hubProof } from "../../src/shared/handshake.ts";
import type { Command, Envelope } from "../../src/shared/protocol.ts";
import { sign, type Secrets } from "../../src/server/pairing.ts";
import { startHub } from "../../src/server/hub.ts";
import type { UiToMain } from "../../src/plugin/messages.ts";
import {
  HUB_URL,
  RECONNECT_MS,
  createClient,
  type ClientDeps,
  type SocketLike,
} from "../../src/plugin/ui/client.ts";
import { randomNonce, webCryptoHmac } from "../../src/plugin/ui/webcrypto.ts";

const hmac = webCryptoHmac(globalThis.crypto.subtle);

class FakeSocket implements SocketLike {
  sent: any[] = [];
  closed = false;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  constructor(public url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.({ code: 1000 });
  }
  receive(e: Envelope | Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(e) });
  }
  serverClose(code: number) {
    this.closed = true;
    this.onclose?.({ code });
  }
  last() {
    return this.sent[this.sent.length - 1];
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const toMain: UiToMain[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const deps: ClientDeps = {
    hmac,
    nonce: randomNonce,
    openSocket(url) {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    toMain: (m) => toMain.push(m),
    onChange() {},
    setTimer(fn, ms) {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer(t) {
      const i = timers.indexOf(t as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const client = createClient(deps);
  const socket = () => sockets[sockets.length - 1];
  const fire = () => timers.splice(0).forEach((t) => t.fn());
  return { client, sockets, socket, toMain, timers, fire };
}

const HUB_NONCE = randomBytes(16).toString("hex");

// Plays the hub side of the handshake on the newest fake socket.
async function welcome(h: ReturnType<typeof harness>, key: string, extra: { secret?: string; badProof?: boolean } = {}) {
  h.socket().receive({ t: "challenge", nonce: HUB_NONCE });
  await h.client.settled();
  const hello = h.socket().last();
  expect(hello.proof).toBe(await clientProof(sign, key, HUB_NONCE, hello.nonce));
  const proof = await hubProof(sign, extra.badProof ? "wrong-key" : key, hello.nonce, HUB_NONCE);
  h.socket().receive(extra.secret ? { t: "welcome", proof, secret: extra.secret } : { t: "welcome", proof });
  await h.client.settled();
  return hello;
}

const signed = (secret: string, cmd: Command) => ({ t: "cmd", sig: sign(secret, cmdSigPayload(cmd)), cmd });

describe("webcrypto helpers", () => {
  it("HMAC matches the server's sign()", async () => {
    expect(await hmac("key", "payload")).toBe(sign("key", "payload"));
  });

  it("nonce is fresh hex the hub accepts", () => {
    const a = randomNonce();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomNonce()).not.toBe(a);
  });
});

describe("ui client", () => {
  it("asks for a code and opens no socket when there is no secret", () => {
    const h = harness();
    h.client.init(undefined, "File");
    expect(h.sockets).toHaveLength(0);
    expect(h.client.view()).toMatchObject({ status: "needs-code", needsCode: true });
  });

  it("pairs with a trimmed, uppercased code and stores the secret only after the hub proves itself", async () => {
    const h = harness();
    h.client.init(undefined, "Design System");
    h.client.pair("  ab3k9z \n");
    expect(h.socket().url).toBe(HUB_URL);
    expect(HUB_URL).toBe("ws://127.0.0.1:39917");
    const hello = await welcome(h, "AB3K9Z", { secret: "new-secret" });
    expect(hello).toMatchObject({ t: "hello-plugin", pair: true, fileName: "Design System" });
    expect(h.toMain).toEqual([{ type: "save-secret", secret: "new-secret" }]);
    expect(h.client.view()).toMatchObject({ status: "connected", needsCode: false });
  });

  it("does not store a secret or trust the link when the hub proof is wrong", async () => {
    const h = harness();
    h.client.init(undefined, "File");
    h.client.pair("AB3K9Z");
    await welcome(h, "AB3K9Z", { secret: "evil-secret", badProof: true });
    expect(h.toMain).toEqual([]);
    expect(h.socket().closed).toBe(true);
    expect(h.client.view().status).not.toBe("connected");
    // A command after the failed welcome is never forwarded.
    h.socket().receive(signed("evil-secret", { id: "x", name: "rename", args: {} }));
    await h.client.settled();
    expect(h.toMain).toEqual([]);
    // No automatic retry against a server that failed its proof.
    expect(h.timers).toHaveLength(0);
  });

  it("reconnects with a stored secret without pairing and forwards a correctly signed command", async () => {
    const h = harness();
    h.client.init("stored", "File");
    const hello = await welcome(h, "stored");
    expect(hello.pair).toBeUndefined();
    expect(h.client.view().status).toBe("connected");

    const cmd: Command = { id: "c1", name: "rename", args: { id: "1:2", name: "Card" } };
    h.socket().receive(signed("stored", cmd));
    await h.client.settled();
    expect(h.toMain).toEqual([{ type: "cmd", cmd }]);

    h.client.fromMain({ id: "c1", ok: true, data: { done: true } });
    expect(h.socket().last()).toEqual({ t: "res", res: { id: "c1", ok: true, data: { done: true } } });
    expect(h.client.view().log[0]).toMatchObject({ name: "rename", state: "ok" });
  });

  it("rejects a command whose args were changed after signing with AUTH_FAILED and does not forward it", async () => {
    const h = harness();
    h.client.init("stored", "File");
    await welcome(h, "stored");
    const good = signed("stored", { id: "c2", name: "delete_nodes", args: { ids: ["1:2"] } });
    h.socket().receive({ ...good, cmd: { ...good.cmd, args: { ids: ["1:2", "1:3"] } } });
    await h.client.settled();
    expect(h.toMain).toEqual([]);
    expect(h.socket().last()).toMatchObject({ t: "res", res: { id: "c2", ok: false, code: "AUTH_FAILED" } });
    expect(h.client.view().log[0]).toMatchObject({ name: "delete_nodes", state: "error" });
  });

  it("retries every 2 s while the server is down", async () => {
    const h = harness();
    h.client.init("stored", "File");
    h.socket().serverClose(1006);
    await h.client.settled();
    expect(h.client.view().status).toBe("disconnected");
    expect(h.timers.map((t) => t.ms)).toEqual([RECONNECT_MS]);
    expect(RECONNECT_MS).toBe(2000);
    h.fire();
    expect(h.sockets).toHaveLength(2);
    await welcome(h, "stored");
    expect(h.client.view().status).toBe("connected");
  });

  it("asks for a new code when the hub denies the pairing code", async () => {
    const h = harness();
    h.client.init(undefined, "File");
    h.client.pair("WRONG1");
    h.socket().receive({ t: "challenge", nonce: HUB_NONCE });
    await h.client.settled();
    h.socket().receive({ t: "denied", code: "AUTH_FAILED" });
    h.socket().serverClose(4001);
    await h.client.settled();
    expect(h.client.view()).toMatchObject({
      status: "needs-code",
      needsCode: true,
      message: "Code not accepted. Wait a moment and try again.",
    });
    expect(h.timers).toHaveLength(0);
  });

  it("does not prompt for a code on its own when the hub denies the stored secret", async () => {
    const h = harness();
    h.client.init("stored", "File");
    h.socket().receive({ t: "challenge", nonce: HUB_NONCE });
    await h.client.settled();
    h.socket().receive({ t: "denied", code: "AUTH_FAILED" });
    h.socket().serverClose(4001);
    await h.client.settled();
    expect(h.client.view()).toMatchObject({ status: "rejected", needsCode: false, canPairAgain: true });
    expect(h.client.view().message).toContain("choose Pair again");
    expect(h.timers).toHaveLength(0);
    expect(h.toMain).toEqual([]);
    h.client.pairAgain();
    expect(h.client.view()).toMatchObject({ status: "needs-code", needsCode: true, canPairAgain: false });
  });

  it("does not fight another plugin window that took over", async () => {
    const h = harness();
    h.client.init("stored", "File");
    await welcome(h, "stored");
    h.socket().serverClose(4000);
    await h.client.settled();
    expect(h.client.view().status).toBe("replaced");
    expect(h.timers).toHaveLength(0);
  });

  it("unpair forgets the secret, closes the link and shows the code input", async () => {
    const h = harness();
    h.client.init("stored", "File");
    await welcome(h, "stored");
    h.client.unpair();
    expect(h.toMain).toEqual([{ type: "unpair" }]);
    expect(h.socket().closed).toBe(true);
    await h.client.settled();
    expect(h.client.view()).toMatchObject({ status: "needs-code", needsCode: true });
    expect(h.timers).toHaveLength(0);
  });

  it("keeps only the last 20 commands in the log", async () => {
    const h = harness();
    h.client.init("stored", "File");
    await welcome(h, "stored");
    for (let i = 0; i < 25; i++) h.socket().receive(signed("stored", { id: `c${i}`, name: "status", args: {} }));
    await h.client.settled();
    const log = h.client.view().log;
    expect(log).toHaveLength(20);
    expect(log[0].id).toBe("c24");
  });
});

describe("ui client confirm queue", () => {
  async function connected() {
    const h = harness();
    h.client.init("stored", "File");
    await welcome(h, "stored");
    h.client.confirmRequest(1, "Delete 6 nodes");
    h.client.confirmRequest(2, "Delete component Card");
    expect(h.client.view().confirm).toEqual({ id: 1, summary: "Delete 6 nodes" });
    return h;
  }

  it("shows confirms one at a time and replies with the user's answer", async () => {
    const h = await connected();
    h.client.answerConfirm(true);
    expect(h.client.view().confirm).toEqual({ id: 2, summary: "Delete component Card" });
    h.client.answerConfirm(false);
    expect(h.client.view().confirm).toBeUndefined();
    expect(h.toMain).toEqual([
      { type: "confirm-reply", id: 1, ok: true },
      { type: "confirm-reply", id: 2, ok: false },
    ]);
  });

  const declinedAll = [
    { type: "confirm-reply", id: 1, ok: false },
    { type: "confirm-reply", id: 2, ok: false },
  ];

  it.each([
    ["the socket closes", (h: ReturnType<typeof harness>) => h.socket().serverClose(1006)],
    ["another window takes over", (h: ReturnType<typeof harness>) => h.socket().serverClose(4000)],
  ])("declines every queued confirm when %s; a later Approve sends nothing", async (_label, lose) => {
    const h = await connected();
    lose(h);
    await h.client.settled();
    expect(h.toMain).toEqual(declinedAll);
    expect(h.client.view().confirm).toBeUndefined();
    h.client.answerConfirm(true);
    expect(h.toMain).toEqual(declinedAll);
  });

  it("declines every queued confirm on unpair", async () => {
    const h = await connected();
    h.client.unpair();
    expect(h.toMain).toEqual([...declinedAll, { type: "unpair" }]);
    expect(h.client.view().confirm).toBeUndefined();
  });

  it("declines a confirm at once when no link is ready", () => {
    const h = harness();
    h.client.init("stored", "File");
    h.client.confirmRequest(7, "Delete");
    expect(h.toMain).toEqual([{ type: "confirm-reply", id: 7, ok: false }]);
    expect(h.client.view().confirm).toBeUndefined();
  });

  it("hides a confirm the main thread expired, without replying", async () => {
    const h = await connected();
    h.client.confirmCancel(1);
    expect(h.client.view().confirm).toEqual({ id: 2, summary: "Delete component Card" });
    expect(h.toMain).toEqual([]);
  });
});

describe("ui client against the real hub", () => {
  const cleanups: (() => unknown)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = createServer();
      srv.once("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const { port } = srv.address() as { port: number };
        srv.close(() => resolve(port));
      });
    });
  }

  async function until(check: () => boolean) {
    for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(check()).toBe(true);
  }

  it("pairs with the hub's code, stores the secret, then runs a signed command", async () => {
    let saved: Secrets | null = null;
    const store = {
      load: async () => saved,
      save: async (s: Secrets) => void (saved = { ...s }),
      clearPlugin: async () => {},
    };
    const port = await freePort();
    const hub = await startHub({ port, host: "127.0.0.1", store, timeouts: { request: 2000, confirm: 2000 } });
    cleanups.push(() => hub.close());

    const toMain: UiToMain[] = [];
    const client = createClient({
      hmac,
      nonce: randomNonce,
      openSocket: () => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        cleanups.push(() => ws.terminate());
        return ws as unknown as SocketLike;
      },
      toMain(m) {
        toMain.push(m);
        if (m.type === "cmd") setTimeout(() => client.fromMain({ id: m.cmd.id, ok: true, data: m.cmd.args }), 0);
      },
      onChange() {},
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    });
    cleanups.push(() => client.unpair());

    client.init(undefined, "Design System");
    client.pair(` ${hub.status().pairingCode!.toLowerCase()} `);
    await until(() => client.view().status === "connected");
    expect(toMain[0]).toEqual({ type: "save-secret", secret: saved!.plugin });
    expect(hub.status()).toMatchObject({ pluginConnected: true, fileName: "Design System" });

    const res = await hub.send("rename", { id: "1:2", name: "Card" });
    expect(res).toMatchObject({ ok: true, data: { id: "1:2", name: "Card" } });
  });
});
