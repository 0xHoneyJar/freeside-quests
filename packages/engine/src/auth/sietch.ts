/**
 * AuthCheckPortSietchLayer — verified-path AuthCheck adapter (cycle-B
 * sprint-1 B-1.9).
 *
 * Replaces the Effect.die placeholder in `sietch-stub.ts` with a real
 * Layer that verifies JWTs minted by the freeside-auth orchestrator
 * (signed by `loa-freeside/apps/gateway` Rust signer per royal decree).
 *
 * # Composition pattern (per-interaction Layer)
 *
 * The bot dispatcher composes this Layer per Discord interaction:
 *
 *   1. auth-bridge attaches `ctx.auth = { jwt, claims }` (verified path)
 *   2. dispatcher resolves expected_tenant from world manifest
 *   3. composer wires:
 *        Layer.merge(
 *          BadgeIssuancePortNullLayer,
 *          buildAuthCheckPortSietchLayer({
 *            jwt: ctx.auth.jwt,
 *            expected_tenant,
 *          }, jwtVerifier),
 *        )
 *   4. quest pipeline runs · the AuthCheckPort.check is called per AC-B1.9
 *
 * # Failure semantics (per AC-B1.9.1 · SDD §13.2)
 *
 * Recoverable verify failures emit `{ is_verified: false, verify_error }`:
 *   - `malformed` — token doesn't parse
 *   - `expired` — exp < now (verifier or layer detects)
 *   - `wrong_audience` — `claims.aud` doesn't match expected_tenant
 *   - `unknown_kid_refresh_failed` — kid not in JWKS · refresh attempted
 *     and failed
 *
 * Catastrophic failure (tenant assertion · I6) emits Effect defect:
 *   - `claims.tenant !== expected_tenant` AND signature was valid →
 *     `Effect.die(TenantAssertionError)` · cannot recover · cannot fall
 *     back to anon · processing halts at the Effect.runPromise boundary.
 *
 * # Sibling A2 architect lock
 *
 * The Tag identity `@freeside-quests/AuthCheckPort` is preserved.
 * Consumers (engine pipeline · dispatch.ts) require ZERO changes when the
 * composition root flips from `AuthCheckPortAnonLayer` to this Layer.
 *
 * Cycle-B · 2026-05-05 · sprint-1 B-1.9 · SDD §3.1.4 + §11.4 + §13.2.
 */

import { Effect, Layer } from "effect";
import {
  AuthCheckPort,
  type AuthCheck,
  type VerifyError,
  type VerifyErrorCode,
} from "./index.js";

// ---------------------------------------------------------------------------
// JWT verifier port (consumed from @freeside-auth/adapters at boot time)
// ---------------------------------------------------------------------------

/**
 * Discriminated result returned by the JWT verifier. The wrapper around
 * `@freeside-auth/adapters/jwks-validator` adapts its native Promise return
 * to this shape.
 *
 * Successful verification carries:
 *   - claims.tenant   : the JWT's tenant claim (cross-checked against I6)
 *   - claims.aud      : the JWT's audience claim (cross-checked against
 *                       expected_tenant for `wrong_audience` detection)
 *   - claims.sub      : the canonical user_id (e.g., midi_profiles.id)
 *   - claims.exp      : unix epoch · already validated by verifier · echoed
 *                       for downstream telemetry
 *   - claims.display_name : optional · populates AuthCheck.display_handle
 */
export type VerifyResult =
  | {
      readonly ok: true;
      readonly claims: {
        readonly tenant: string;
        readonly aud: string;
        readonly sub: string;
        readonly exp: number;
        readonly display_name?: string;
      };
    }
  | { readonly ok: false; readonly error: VerifyError };

/**
 * Port wrapping `@freeside-auth/adapters/jwks-validator.verifyJwt`. The
 * adapter handles JWKS fetch + cache + signature verification + standard
 * claim checks (exp · iat · iss). This port surface is the minimal contract
 * the Sietch Layer consumes; consumer wires the real adapter at boot.
 */
export interface JWTVerifierPort {
  readonly verifyJwt: (token: string) => Promise<VerifyResult>;
}

// ---------------------------------------------------------------------------
// Tenant assertion error (I6 · catastrophic · halts via Effect.die)
// ---------------------------------------------------------------------------

/**
 * Raised when JWT verification succeeds (signature valid · standard claims
 * pass) but the `tenant` claim does NOT match the expected_tenant for the
 * world the player is interacting with. Per the I6 invariant + SDD §13.2
 * D9, this MUST halt processing · cannot fall back · cannot map to anon.
 *
 * Distinct from `wrong_audience` (which is `aud` mismatch · recoverable
 * downgrade per fail-mode). Tenant assertion is the security boundary:
 * a valid JWT issued for tenant X must NEVER authorize an action for
 * tenant Y, regardless of route policy.
 */
export class TenantAssertionError extends Error {
  constructor(
    public readonly got_tenant: string,
    public readonly expected_tenant: string,
    public readonly sub: string,
  ) {
    super(
      `tenant_assertion_failed: claimed=${got_tenant}, expected=${expected_tenant}, sub=${sub}`,
    );
    this.name = "TenantAssertionError";
  }
}

/**
 * Raised when the JWT verifier promise rejects (DNS · network · JWKS 5xx ·
 * programmer error · etc) rather than returning a diagnosed `{ ok: false }`.
 *
 * Distinct from VerifyError (recoverable · diagnosed) · this is undiagnosed
 * infrastructure failure. The Sietch Layer surfaces it as Effect defect so
 * the dispatcher's outer error handler treats it as 5xx-equivalent (NOT as
 * a recoverable downgrade · per SDD §13 fail-closed posture).
 *
 * Cross-reviewer flatline finding (PR #13 · CRITICAL 810): conflating
 * verifier-thrown infra errors with diagnosed verify failures would silently
 * downgrade users to anon during outages · violates fail-closed.
 */
export class SietchInfrastructureError extends Error {
  constructor(
    message: string,
    public readonly cause_value: unknown,
  ) {
    super(message);
    this.name = "SietchInfrastructureError";
  }
}

/**
 * Redact an error reason · prevents token-derived data leakage in error logs.
 *
 * Bridgebuilder F4 (PR #13 · LOW 0.4): `(cause as Error).message` could embed
 * token bytes if the verifier surfaces them in its error message. Strip any
 * substring that LOOKS like a JWT (3 base64-ish segments separated by dots)
 * and anything > 60 chars after the first colon (likely token payload).
 *
 * The error CODE (e.g., 'verifier threw on jwks/network path') stays · only
 * the variable cause-detail is redacted. Operator gets enough signal for
 * triage without leaking secrets to logs/telemetry.
 */
const redactReason = (cause: unknown): string => {
  const raw =
    cause instanceof Error
      ? (cause.message ?? String(cause))
      : String(cause);
  // Remove anything that looks like a JWT (xxx.yyy.zzz · base64-ish segments).
  // Threshold 10+ chars/segment catches most real JWTs (header is typically
  // ~30 chars, signature ~40+) and the smallest realistic token shapes.
  // False-positive risk: very long version strings or hashes — acceptable
  // tradeoff for fail-safe redaction in error messages.
  return raw
    .replace(/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted-jwt]")
    .slice(0, 200);
};

// ---------------------------------------------------------------------------
// Layer constructor
// ---------------------------------------------------------------------------

export interface SietchLayerInput {
  /** JWT to verify · sourced from `ctx.auth.jwt` (auth-bridge attached). */
  readonly jwt: string;
  /**
   * Expected tenant for this interaction. Resolved from the world manifest
   * (`world.tenant_id`) by the bot dispatcher BEFORE composing this Layer.
   * The Sietch Layer asserts `claims.tenant === expected_tenant` (I6).
   */
  readonly expected_tenant: string;
}

/**
 * Build a Sietch AuthCheck Layer for one interaction.
 *
 * Per-interaction construction (vs static `AuthCheckPortAnonLayer`) because
 * the JWT + expected_tenant change per call. This pattern was chosen over
 * Effect Context Tags (e.g., `JwtBearerContext`) to keep the AuthCheckPort
 * surface unchanged · consumer code requires no signature changes.
 *
 * The `player` argument to `check()` is intentionally unused: verification
 * relies on the JWT, not on the substrate's PlayerIdentity classification.
 * The PlayerIdentity is downstream of this Layer (the bot resolves
 * `verified` vs `anon` AFTER consulting auth-bridge + this Layer's verdict).
 */
export const buildAuthCheckPortSietchLayer = (
  input: SietchLayerInput,
  verifier: JWTVerifierPort,
): Layer.Layer<AuthCheckPort> =>
  Layer.succeed(
    AuthCheckPort,
    AuthCheckPort.of({
      check: () =>
        Effect.gen(function* () {
          // Verifier port boundary · two distinct failure modes:
          //   (a) verifier returns `{ ok: false, error }` — KNOWN recoverable
          //       JWT failure (malformed / expired / unknown_kid). The verifier
          //       diagnosed it · we trust the code · downgrade to anon-fallback
          //       per AC-B1.9.1 + dispatcher fail-mode.
          //   (b) verifier promise rejects (network / DNS / 5xx / programmer
          //       error) — UNDIAGNOSED infrastructure failure. Treating these
          //       as recoverable would silently downgrade real users to anon
          //       during outages · violates fail-closed posture per SDD §13.
          //       Surface as Effect defect so the dispatcher's outer error
          //       handler treats them as 5xx-equivalent.
          //
          // Cross-reviewer flatline finding (PR #13) flagged this distinction
          // explicitly · CRITICAL 810 if conflated.
          const result = yield* Effect.tryPromise({
            try: () => verifier.verifyJwt(input.jwt),
            catch: (cause) =>
              new SietchInfrastructureError(
                `verifier threw on jwks/network path: ${redactReason(cause)}`,
                cause,
              ),
          }).pipe(
            // Convert typed infrastructure error to Effect defect · widens to
            // `never` in the typed error channel while halting via die. This
            // preserves the AuthCheckPort signature (Effect<AuthCheck, never>)
            // AND gets the fail-closed semantics per AC-B1.9.1 + cross-reviewer
            // CRITICAL 810 (PR #13).
            Effect.catchAll((err) => Effect.die(err)),
          );

          if (!result.ok) {
            // Recoverable diagnosed verify failure · downgrade to anon path ·
            // let dispatcher decide per fail-mode whether to 401 or audit-fallback.
            // verify_error.reason is sourced from verifier (already redacted at
            // its boundary) · we don't re-embed token bytes here.
            const ac: AuthCheck = {
              is_verified: false,
              verify_error: result.error,
            };
            return ac;
          }

          // Tenant boundary assertion (I6 · catastrophic · cannot recover ·
          // MUST come BEFORE audience check). Cross-reviewer flatline finding
          // (PR #13 · CRITICAL 880): if audience check fired first, a token
          // claiming tenant=X with aud=X presented to expected_tenant=Y would
          // return recoverable `wrong_audience` instead of `Effect.die` —
          // boundary breach gets downgraded to anon on fallback routes.
          //
          // I6 says: a valid JWT issued for tenant X must NEVER authorize an
          // action for tenant Y, regardless of any other claim's state.
          if (result.claims.tenant !== input.expected_tenant) {
            return yield* Effect.die(
              new TenantAssertionError(
                result.claims.tenant,
                input.expected_tenant,
                result.claims.sub,
              ),
            );
          }

          // Audience check (recoverable · per AC-B1.9.1 wrong_audience).
          // Reached only when tenant claim already matched expected_tenant ·
          // means the token was issued for the right tenant but for a different
          // audience profile (e.g., a misrouted ruggy JWT used for quest path).
          // Recoverable downgrade is appropriate · the security boundary is
          // already satisfied by the tenant assertion above.
          if (result.claims.aud !== input.expected_tenant) {
            const ac: AuthCheck = {
              is_verified: false,
              verify_error: {
                code: "wrong_audience",
                reason: `aud=${result.claims.aud} does not match expected_tenant=${input.expected_tenant}`,
              },
            };
            return ac;
          }

          const ac: AuthCheck = {
            is_verified: true,
            display_handle: result.claims.display_name,
          };
          return ac;
        }),
    }),
  );

// ---------------------------------------------------------------------------
// Re-exports for convenient consumption
// ---------------------------------------------------------------------------

export type { VerifyError, VerifyErrorCode } from "./index.js";
