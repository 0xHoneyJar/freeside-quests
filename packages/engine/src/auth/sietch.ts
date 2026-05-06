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
          const result = yield* Effect.tryPromise({
            try: () => verifier.verifyJwt(input.jwt),
            catch: (cause): VerifyError => ({
              code: "unknown_kid_refresh_failed",
              reason: `verifier threw: ${(cause as Error)?.message ?? String(cause)}`,
            }),
          }).pipe(
            Effect.catchAll((verifyError) =>
              // verifier promise rejected · treat as recoverable per AC-B1.9.1
              Effect.succeed<VerifyResult>({ ok: false, error: verifyError }),
            ),
          );

          if (!result.ok) {
            // Recoverable verify failure · downgrade to anon path · let
            // dispatcher decide per fail-mode whether to 401 or audit-fallback
            const ac: AuthCheck = {
              is_verified: false,
              verify_error: result.error,
            };
            return ac;
          }

          // Audience check (recoverable · per AC-B1.9.1 wrong_audience)
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

          // Tenant boundary assertion (I6 · catastrophic · cannot recover)
          if (result.claims.tenant !== input.expected_tenant) {
            return yield* Effect.die(
              new TenantAssertionError(
                result.claims.tenant,
                input.expected_tenant,
                result.claims.sub,
              ),
            );
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
