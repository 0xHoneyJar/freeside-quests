/**
 * require-identity.ts — the read-plane auth gate.
 *
 * A Hyper middleware that:
 *   1. extracts the Bearer token from `Authorization: Bearer <jwt>`,
 *   2. verifies it offline (HS256, identity-api issuer) via jwt-verify.ts,
 *   3. on success, stashes the VerifiedIdentity request-scoped so the route
 *      handler reads the AUTHENTICATED identity + world (never a query param),
 *   4. on ANY failure → short-circuits with 401 (the handler never runs).
 *
 * Request-scoped stash: Hyper's `AppContext` is a declaration-merged empty
 * interface and middleware `next()` doesn't thread a typed ctx mutation to the
 * handler cleanly, so we key the verified identity off the `Request` object in
 * a WeakMap. The Request is unique per in-flight request and GC'd when the
 * response settles, so there is no cross-request leak and no unbounded growth.
 * The handler calls `identityOf(req)` to read it back.
 *
 * SECURITY POSTURE:
 *   - This gate is applied to EVERY data route (activities/progress/badges/
 *     raffle). /health + /.well-known/beacon.json do NOT get it (public).
 *   - The middleware NEVER falls open: a missing secret config, missing token,
 *     or any verify error all return 401 with a stable JSON envelope. (A
 *     missing-secret 401 is the safe failure — a public read plane with a
 *     mis-provisioned secret refuses everything rather than serving data
 *     unauthenticated.)
 */

import type { Middleware } from "@hyper/core";

import {
  IDENTITY_API_ISSUER_DEFAULT,
  JwtVerifyError,
  verifyIdentityToken,
  type VerifiedIdentity,
  type VerifyConfig,
} from "./jwt-verify";

/** Request-scoped store of the verified identity. */
const VERIFIED = new WeakMap<Request, VerifiedIdentity>();

/** Read the verified identity a prior `requireIdentity` run stashed. */
export const identityOf = (req: Request): VerifiedIdentity | undefined =>
  VERIFIED.get(req);

export interface AuthConfig {
  /** Shared HS256 secret. Read from IDENTITY_API_JWT_SECRET when omitted. */
  readonly secret: string | undefined;
  /** Required issuer. Read from IDENTITY_API_ISSUER (default "identity-api"). */
  readonly issuer: string;
  readonly audience: string | undefined;
}

/**
 * resolveAuthConfig — read the verifier config from env, no hardcoding.
 *   IDENTITY_API_JWT_SECRET — the HS256 verification secret (required).
 *   IDENTITY_API_ISSUER     — expected `iss` (default "identity-api").
 *   IDENTITY_API_AUDIENCE   — optional `aud` assertion.
 */
export const resolveAuthConfig = (
  env: Record<string, string | undefined> = process.env,
): AuthConfig => ({
  secret: env.IDENTITY_API_JWT_SECRET,
  issuer: env.IDENTITY_API_ISSUER ?? IDENTITY_API_ISSUER_DEFAULT,
  audience: env.IDENTITY_API_AUDIENCE,
});

const unauthorized401 = (code: string): Response =>
  new Response(JSON.stringify({ error: "unauthorized", code }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": 'Bearer realm="activities-api", error="invalid_token"',
    },
  });

const bearerFrom = (req: Request): string | null => {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (h === null) return null;
  const m = /^Bearer[ ]+(.+)$/i.exec(h.trim());
  return m === null ? null : (m[1] as string).trim();
};

/**
 * makeRequireIdentity — build the auth middleware from an AuthConfig.
 *
 * Exposed as a factory (rather than a module-level singleton) so the
 * composition root supplies the resolved config and tests can inject a
 * deterministic secret/issuer.
 */
export const makeRequireIdentity = (config: AuthConfig): Middleware => {
  const verifyConfig: VerifyConfig | null =
    config.secret !== undefined && config.secret.length > 0
      ? {
          secret: config.secret,
          issuer: config.issuer,
          ...(config.audience !== undefined && { audience: config.audience }),
        }
      : null;

  return async ({ req, next }) => {
    if (verifyConfig === null) {
      // Fail CLOSED: no secret means we cannot verify → refuse, never serve.
      return unauthorized401("no_secret_configured");
    }
    const token = bearerFrom(req);
    if (token === null) {
      return unauthorized401("missing_token");
    }
    try {
      const identity = await verifyIdentityToken(token, verifyConfig);
      VERIFIED.set(req, identity);
      return next();
    } catch (e) {
      if (e instanceof JwtVerifyError) {
        return unauthorized401(e.code);
      }
      // Defense-in-depth: any non-JwtVerifyError parse/crypto fault is still a
      // bad-token condition → 401, NOT a 500 leak (L7 hardening).
      return unauthorized401("invalid_token");
    }
  };
};
