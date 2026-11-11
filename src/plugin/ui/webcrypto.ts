// Crypto pieces of the UI iframe. The plugin main thread has no crypto, so HMAC lives here.
// Figma desktop runs the UI in a null-origin iframe without crypto.subtle (checked in real Figma,
// 2026-11-11), so HMAC uses a pure-JS SHA-256. crypto.getRandomValues is still available there.
import { hmac as nobleHmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Hmac } from "../../shared/handshake.ts";

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const enc = new TextEncoder();

// HMAC-SHA256 as lowercase hex, the same output as server/pairing.ts `sign`.
export const uiHmac: Hmac = async (secret, payload) => hex(nobleHmac(sha256, enc.encode(secret), enc.encode(payload)));

// 16 random bytes as 32 hex chars, within the hub's nonce length limits.
export const randomNonce = () => hex(crypto.getRandomValues(new Uint8Array(16)));
