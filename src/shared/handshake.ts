// Mutual challenge-response used on every hub link. Pure and ES2017-safe so the plugin bundle can reuse it.
// HMAC-SHA256 hex is injected: Node passes `sign` from server/pairing.ts, the plugin passes a WebCrypto version.
export type Hmac = (secret: string, payload: string) => string | Promise<string>;

// Hub nonce is fixed-length hex, so plain concatenation is unambiguous; the prefixes stop reflection.
export const clientProof = (hmac: Hmac, secret: string, hubNonce: string, clientNonce: string) =>
  Promise.resolve(hmac(secret, `client:${hubNonce}${clientNonce}`));

export const hubProof = (hmac: Hmac, secret: string, clientNonce: string, hubNonce: string) =>
  Promise.resolve(hmac(secret, `hub:${clientNonce}${hubNonce}`));

export const NONCE_MIN = 16;
export const NONCE_MAX = 128;
export const validNonce = (n: unknown): n is string =>
  typeof n === "string" && n.length >= NONCE_MIN && n.length <= NONCE_MAX;

// Constant-time string compare without Node Buffer.
export function sameProof(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// The string every `cmd.sig` signs: covers id, name and args, so no part can be swapped after signing.
export const cmdSigPayload = (cmd: { id: string; name: string; args: unknown }) =>
  cmd.id + cmd.name + JSON.stringify(cmd.args);
