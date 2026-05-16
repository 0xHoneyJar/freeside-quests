/**
 * KeyProviderPort — per-world key resolution port (S1.T1.16b · sprint-2 review C2).
 *
 * Defined per sprint-plan §12.3 Fix-S4 + Fix-S7. Worlds supply a real
 * implementation (Vault · AWS KMS · per-world JWKS); the test fixture
 * wraps an in-memory Map<kid, KeyState>.
 *
 * Rotation states (per Fix-S7):
 *   - active  → key is in production use; tokens signed with it MUST verify
 *   - grace   → key is rotating out but tokens already issued with it remain
 *               valid until their `exp` (or the grace window expires)
 *   - revoked → key is invalidated; tokens signed with it MUST fail
 *
 * The substrate enforces the contract; worlds enforce policy (when to
 * promote active → grace, when to revoke, etc).
 */
import type { Effect } from "effect";
import { Data, Schema } from "effect";

import { RFC3339Date } from "../encoding/date.js";

export const KeyRotationState = Schema.Literal("active", "grace", "revoked");
export type KeyRotationState = Schema.Schema.Type<typeof KeyRotationState>;

/**
 * KeyState — what KeyProviderPort.resolveKey returns. The substrate uses
 * `key_material_hex` opaquely; production callers verify Ed25519 against it.
 */
export const KeyState = Schema.Struct({
  kid: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  key_material_hex: Schema.String.pipe(
    Schema.pattern(/^[a-f0-9]+$/),
    Schema.minLength(2),
    Schema.maxLength(2048),
  ),
  state: KeyRotationState,
  /** When the key entered its current state. */
  state_since: RFC3339Date,
  /** When the key expires (regardless of rotation state). */
  expires_at: RFC3339Date,
});

export type KeyState = Schema.Schema.Type<typeof KeyState>;

/**
 * KeyProviderError — sealed Data.TaggedError union for resolveKey failures.
 *
 * Variants follow the pattern from FR-8 sealed error unions: each variant
 * carries just enough context for the caller to act (kid for log
 * correlation · resolver_id for blast-radius scope · no key material in
 * error payloads — those stay opaque).
 */
export class KidNotFound extends Data.TaggedError("KidNotFound")<{
  readonly kid: string;
}> {}

export class KeyExpired extends Data.TaggedError("KeyExpired")<{
  readonly kid: string;
  readonly expired_at: string;
}> {}

export class KeyRevoked extends Data.TaggedError("KeyRevoked")<{
  readonly kid: string;
  readonly revoked_at: string;
}> {}

export class KeyProviderUnavailable extends Data.TaggedError("KeyProviderUnavailable")<{
  readonly resolver_id: string;
  readonly reason: string;
}> {}

export type KeyProviderError =
  | KidNotFound
  | KeyExpired
  | KeyRevoked
  | KeyProviderUnavailable;

/**
 * KeyProviderPort — substrate seam for kid → KeyState resolution
 * (cross-pack via Effect Tag identity).
 *
 * Implementations:
 *   - production: world-supplied (Vault · KMS · JWKS)
 *   - test fixture: in-memory Map<kid, KeyState> (planned for `@0xhoneyjar/freeside-activities-adapters`
 *     in a follow-up cycle · sprint-2 ships the interface only)
 *
 * Per IMP-005: tests for `kid mid-rotation` (active key works) ·
 * `expired key rejected` · `revoked key rejected` · `active + grace
 * overlap window works` validate adapter conformance against this port.
 */
export interface KeyProviderPort {
  readonly resolveKey: (kid: string) => Effect.Effect<KeyState, KeyProviderError>;
  /**
   * Lists the active set of kids the provider currently considers usable.
   * Production gateways query this on JWKS discovery refresh; tests use it
   * to verify the rotation state of seeded keys.
   *
   * MUST include kids in `active` or `grace` state. MUST NOT include
   * `revoked` kids.
   */
  readonly listActiveKids: () => Effect.Effect<
    ReadonlyArray<KeyState>,
    KeyProviderUnavailable
  >;
}
