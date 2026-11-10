import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fileSecretStore,
  newPairingCode,
  newSecret,
  safeEqual,
  sign,
} from "../../src/server/pairing.ts";

const tempDir = () => mkdtemp(join(tmpdir(), "pairing-test-"));

describe("newPairingCode", () => {
  it("is 6 chars from the allowed alphabet", () => {
    for (let i = 0; i < 200; i++) {
      expect(newPairingCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });
});

describe("newSecret", () => {
  it("is 32 bytes base64url and unique", () => {
    const a = newSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSecret()).not.toBe(a);
  });
});

describe("fileSecretStore", () => {
  it("returns null when no file exists", async () => {
    const store = fileSecretStore(await tempDir());
    expect(await store.load()).toBeNull();
  });

  it("round-trips and writes mode 0600 in a 0700 dir", async () => {
    const dir = join(await tempDir(), "nested");
    const store = fileSecretStore(dir);
    await store.save({ server: "s", plugin: "p" });
    expect(await store.load()).toEqual({ server: "s", plugin: "p" });
    const file = join(dir, "figma-starter-mcp", "pairing.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, "figma-starter-mcp"))).mode & 0o777).toBe(0o700);
  });

  it("clearPlugin keeps server and removes plugin", async () => {
    const dir = await tempDir();
    const store = fileSecretStore(dir);
    await store.save({ server: "s", plugin: "p" });
    await store.clearPlugin();
    expect(await store.load()).toEqual({ server: "s" });
  });

  it("clearPlugin is a no-op without a file", async () => {
    const store = fileSecretStore(await tempDir());
    await store.clearPlugin();
    expect(await store.load()).toBeNull();
  });

  it("throws a clear error on a corrupt file", async () => {
    const dir = await tempDir();
    const store = fileSecretStore(dir);
    await store.save({ server: "s" });
    await writeFile(join(dir, "figma-starter-mcp", "pairing.json"), "{oops");
    await expect(store.load()).rejects.toThrow(/pairing\.json/);
    await writeFile(join(dir, "figma-starter-mcp", "pairing.json"), "{}");
    await expect(store.load()).rejects.toThrow(/pairing\.json/);
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is empty", async () => {
    const home = await tempDir();
    const saved = { HOME: process.env.HOME, XDG: process.env.XDG_CONFIG_HOME };
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = "";
    try {
      await fileSecretStore().save({ server: "s" });
    } finally {
      process.env.HOME = saved.HOME;
      if (saved.XDG === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = saved.XDG;
    }
    expect(JSON.parse(await readFile(join(home, ".config", "figma-starter-mcp", "pairing.json"), "utf8"))).toEqual({ server: "s" });
  });

  it("leaves no temp files behind", async () => {
    const dir = await tempDir();
    await fileSecretStore(dir).save({ server: "s" });
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(join(dir, "figma-starter-mcp"))).toEqual(["pairing.json"]);
    expect(JSON.parse(await readFile(join(dir, "figma-starter-mcp", "pairing.json"), "utf8"))).toEqual({ server: "s" });
  });
});

describe("sign / safeEqual", () => {
  it("sign is deterministic HMAC-SHA256 hex", () => {
    expect(sign("k", "m")).toBe(sign("k", "m"));
    expect(sign("k", "m")).toMatch(/^[0-9a-f]{64}$/);
    expect(sign("k", "m")).not.toBe(sign("k2", "m"));
  });

  it("safeEqual compares and is false on different length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
