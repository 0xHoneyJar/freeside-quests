/**
 * mint-test-token.ts — mint an HS256 identity-api-shaped session JWT for
 * local verification (mirrors freeside-auth/src/jwt-mint.ts claim shape).
 *
 * Usage: bun mint-test-token.ts <secret> <sub> <tenant> [iss] [ttlSec]
 * Prints the encoded JWT to stdout.
 */

const b64url = (bytes: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlStr = (s: string): string => b64url(new TextEncoder().encode(s));

const mint = async (
  secret: string,
  sub: string,
  tenant: string,
  iss: string,
  ttlSec: number,
): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub,
    tenant,
    wallets: [{ chain: "ethereum", address: "0x0000000000000000000000000000000000000001" }],
    iss,
    aud: "freeside",
    iat: now,
    exp: now + ttlSec,
    jti: crypto.randomUUID(),
    v: 1,
  };
  const signingInput = `${b64urlStr(JSON.stringify(header))}.${b64urlStr(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${b64url(sig)}`;
};

const [, , secret, sub, tenant, iss = "identity-api", ttl = "3600"] = process.argv;
if (!secret || !sub || !tenant) {
  process.stderr.write("usage: mint-test-token.ts <secret> <sub> <tenant> [iss] [ttlSec]\n");
  process.exit(2);
}
process.stdout.write(await mint(secret, sub, tenant, iss, Number.parseInt(ttl, 10)));
