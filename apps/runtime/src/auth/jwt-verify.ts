/**
 * jwt-verify.ts — server-side verification of an identity-api Bearer JWT.
 *
 * GROUNDING (why HS256-offline, NOT JWKS):
 *   The identity-api user **session** token is minted by freeside-auth's
 *   `mintSessionJwt` (freeside-auth/src/jwt-mint.ts) as an **HS256** JWT
 *   signed with the shared `JWT_SECRET` — the SAME secret the issuer verifies
 *   against (symmetric). ES256 + a public `/.well-known/jwks.json` is the
 *   *documented future* posture (freeside-auth PRD §4.4 FR-J2, Sprint-1.1
 *   follow-up #3, "harvested from loa-freeside") but is NOT live today: there
 *   is no asymmetric user-JWKS document to fetch. JWKS-offline verification is
 *   therefore impossible to do *honestly* against the current token — there is
 *   no public key. The production-correct verifier mirrors the issuer:
 *   **HS256 over a shared secret**, supplied here via `IDENTITY_API_JWT_SECRET`.
 *
 *   This is a fully OFFLINE verify (no `/v1/me` round-trip): we recompute the
 *   HMAC and compare in constant time. The `/v1/me` fallback the #21 review
 *   names is NOT used — it adds a hard network dependency + latency on every
 *   read and a symmetric offline check is strictly stronger (no TOCTOU window,
 *   no upstream-availability coupling).
 *
 *   SWAP-SEAM: when freeside-auth lands ES256 + a live JWKS endpoint
 *   (FR-J2), replace `verifyHs256` with a `jose`-based `jwtVerify(token,
 *   createRemoteJWKSet(new URL(issuer + "/.well-known/jwks.json")))`. The
 *   middleware + claim extraction below are algorithm-agnostic; only the
 *   signature step changes. Keeping the boundary here makes that a one-function
 *   edit. (Mirrors freeside-auth/src/auth.ts header "ES256 swap" seam.)
 *
 * Claims shape (freeside-auth/packages/protocol/src/jwt-claims.ts JWTClaim):
 *   { sub (=user_id/identity), tenant (=world scope), iss, aud, exp, iat,
 *     jti, wallets[], v:1, tier? }
 *
 * The verifier is hardened against the same L7 leak freeside-auth/src/auth.ts
 * documents: a malformed (non-base64 / non-JSON) token MUST surface as an auth
 * failure (caught by the caller → 401), NEVER a 500.
 */

import { timingSafeEqual } from "node:crypto";

/** The issuer the identity-api session token carries (`iss` claim). */
export const IDENTITY_API_ISSUER_DEFAULT = "identity-api";

/**
 * The verified, trusted claims we extract. A subset of the full JWTClaim —
 * exactly the fields the read plane scopes on.
 */
export interface VerifiedIdentity {
  /** `sub` — the authenticated identity (user_id). The ONLY identity a
   *  request may read. Never taken from a query param. */
  readonly identity_id: string;
  /** `tenant` — the world scope. A request may only read within this world. */
  readonly world: string;
  readonly iss: string;
  readonly aud: string | undefined;
  readonly exp: number | undefined;
  readonly jti: string | undefined;
}

export type JwtVerifyFailureCode =
  | "no_secret_configured"
  | "missing_token"
  | "malformed_token"
  | "alg_not_allowed"
  | "bad_signature"
  | "expired"
  | "not_yet_valid"
  | "bad_issuer"
  | "missing_sub"
  | "missing_tenant";

export class JwtVerifyError extends Error {
  constructor(
    readonly code: JwtVerifyFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "JwtVerifyError";
  }
}

interface JwtHeader {
  readonly alg?: string;
  readonly typ?: string;
  readonly kid?: string;
}

interface JwtPayload {
  readonly sub?: string;
  readonly tenant?: string;
  readonly iss?: string;
  readonly aud?: string;
  readonly exp?: number;
  readonly nbf?: number;
  readonly iat?: number;
  readonly jti?: string;
  readonly [k: string]: unknown;
}

export interface VerifyConfig {
  /** Shared HS256 secret (the identity-api JWT_SECRET). */
  readonly secret: string;
  /** Required issuer; rejects tokens whose `iss` differs. */
  readonly issuer: string;
  /** Optional audience assertion (off by default — V1 aud is a coarse 'freeside'). */
  readonly audience?: string;
  /** Clock-skew tolerance in seconds. Default 30 (matches Hyper's verifyJwt). */
  readonly clockToleranceSec?: number;
}

const b64urlToBytes = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const b64 = (s + "====".slice(0, pad)).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const b64urlToUtf8 = (s: string): string =>
  new TextDecoder("utf-8", { fatal: true }).decode(b64urlToBytes(s));

/**
 * verifyIdentityToken — verify an HS256 identity-api Bearer JWT, fully offline.
 *
 * Returns the trusted {@link VerifiedIdentity}. Throws {@link JwtVerifyError}
 * on ANY failure (malformed, bad sig, expired, wrong issuer, missing scope
 * claims). All parse-level faults are normalized to a JwtVerifyError so the
 * caller renders 401 — never letting a SyntaxError leak as a 500 (the L7 leak
 * freeside-auth/src/auth.ts documents).
 */
export const verifyIdentityToken = async (
  token: string,
  config: VerifyConfig,
): Promise<VerifiedIdentity> => {
  if (!config.secret || config.secret.length === 0) {
    throw new JwtVerifyError(
      "no_secret_configured",
      "IDENTITY_API_JWT_SECRET is not set; the read plane cannot verify tokens",
    );
  }

  let header: JwtHeader;
  let payload: JwtPayload;
  let signingInput: string;
  let sigBytes: Uint8Array;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new JwtVerifyError("malformed_token", "jwt must have three segments");
    }
    const [h, p, sig] = parts as [string, string, string];
    header = JSON.parse(b64urlToUtf8(h)) as JwtHeader;
    payload = JSON.parse(b64urlToUtf8(p)) as JwtPayload;
    signingInput = `${h}.${p}`;
    sigBytes = b64urlToBytes(sig);
  } catch (e) {
    if (e instanceof JwtVerifyError) throw e;
    // SyntaxError (bad JSON), TypeError (atob on garbage), DOMException
    // (invalid UTF-8) — all attacker-controlled-input parse failures → 401.
    throw new JwtVerifyError("malformed_token", "token is not a decodable JWT");
  }

  const alg = header.alg;
  if (alg !== "HS256") {
    // Reject anything that isn't the issuer's algorithm — including "none"
    // and any asymmetric alg we have no key for. Pinning the alg defeats
    // alg-confusion / alg:none downgrade attacks.
    throw new JwtVerifyError("alg_not_allowed", `disallowed alg: ${String(alg)}`);
  }

  // Recompute HMAC-SHA256 over the signing input and constant-time compare.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(config.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput)),
  );
  if (
    expected.length !== sigBytes.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(sigBytes))
  ) {
    throw new JwtVerifyError("bad_signature", "jwt signature mismatch");
  }

  const now = Math.floor(Date.now() / 1000);
  const skew = config.clockToleranceSec ?? 30;
  if (typeof payload.exp === "number" && now > payload.exp + skew) {
    throw new JwtVerifyError("expired", "jwt expired");
  }
  if (typeof payload.nbf === "number" && now + skew < payload.nbf) {
    throw new JwtVerifyError("not_yet_valid", "jwt not yet valid");
  }
  if (payload.iss !== config.issuer) {
    throw new JwtVerifyError(
      "bad_issuer",
      `issuer ${String(payload.iss)} != ${config.issuer}`,
    );
  }
  if (config.audience !== undefined) {
    const aud = payload.aud;
    const ok = Array.isArray(aud)
      ? (aud as unknown[]).includes(config.audience)
      : aud === config.audience;
    if (!ok) {
      throw new JwtVerifyError("bad_issuer", "aud mismatch");
    }
  }

  // Scope claims MUST be present — without them we cannot enforce the
  // identity/world isolation invariant.
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new JwtVerifyError("missing_sub", "token has no sub (identity) claim");
  }
  if (typeof payload.tenant !== "string" || payload.tenant.length === 0) {
    throw new JwtVerifyError("missing_tenant", "token has no tenant (world) claim");
  }

  return {
    identity_id: payload.sub,
    world: payload.tenant,
    iss: payload.iss,
    aud: typeof payload.aud === "string" ? payload.aud : undefined,
    exp: typeof payload.exp === "number" ? payload.exp : undefined,
    jti: typeof payload.jti === "string" ? payload.jti : undefined,
  };
};
