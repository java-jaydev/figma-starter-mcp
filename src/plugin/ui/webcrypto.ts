// WebCrypto pieces of the UI iframe. The plugin main thread has no crypto, so HMAC lives here.
import type { Hmac } from "../../shared/handshake.ts";

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// HMAC-SHA256 as lowercase hex, the same output as server/pairing.ts `sign`.
export function webCryptoHmac(subtle: SubtleCrypto): Hmac {
  const enc = new TextEncoder();
  return async (secret, payload) => {
    const key = await subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return hex(new Uint8Array(await subtle.sign("HMAC", key, enc.encode(payload))));
  };
}

// 16 random bytes as 32 hex chars, within the hub's nonce length limits.
export const randomNonce = () => hex(crypto.getRandomValues(new Uint8Array(16)));
