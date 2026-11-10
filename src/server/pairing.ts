import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newPairingCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export type Secrets = { server: string; plugin?: string };
export type SecretStore = {
  load(): Promise<Secrets | null>;
  save(s: Secrets): Promise<void>;
  clearPlugin(): Promise<void>;
};

export function fileSecretStore(dir?: string): SecretStore {
  const base = dir ?? (process.env.XDG_CONFIG_HOME || join(homedir(), ".config"));
  const folder = join(base, "figma-starter-mcp");
  const file = join(folder, "pairing.json");

  async function load(): Promise<Secrets | null> {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Corrupt pairing file ${file}: invalid JSON. Fix or delete it to re-pair.`);
    }
    const s = data as Partial<Secrets> | null;
    if (!s || typeof s.server !== "string" || (s.plugin !== undefined && typeof s.plugin !== "string")) {
      throw new Error(`Corrupt pairing file ${file}: unexpected shape. Fix or delete it to re-pair.`);
    }
    return s.plugin === undefined ? { server: s.server } : { server: s.server, plugin: s.plugin };
  }

  async function save(s: Secrets): Promise<void> {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(s), { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, file);
  }

  async function clearPlugin(): Promise<void> {
    const s = await load();
    if (!s) return;
    await save({ server: s.server });
  }

  return { load, save, clearPlugin };
}

export function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
