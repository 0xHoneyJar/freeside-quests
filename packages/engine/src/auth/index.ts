/**
 * AuthCheckPort — gates badge issuance per PRD D4 ("open-accept · badge-gated").
 *
 * Per Eileen's no-paying rail: this gate is OFF by default for quest accept
 * (anon-allowed). It's ONLY consulted at badge-issuance time:
 *   - if is_verified=true  → BadgeIssuancePort runs · badge_uri populated
 *   - if is_verified=false → badge_uri stays null · soft conversion path
 *     (player can `/verify` later · retroactively claim badge)
 *
 * Sibling Session A (mature-freeside-operator sprint-1) lands the real
 * adapter that consumes loa-freeside's identity surface. The default
 * adapter shipped here uses ONLY information already present in the
 * `PlayerIdentity` discriminated union (`type === "verified"`) — it never
 * issues an external auth call. That keeps the substrate functional with
 * zero external dependencies and gives Session A a clean swap-shape (same
 * Tag identity, different Layer · per SDD §10).
 *
 * IDENTITY CONTRACT (mirrors QuestStatePort architect lock A2):
 *   The string `"@freeside-quests/AuthCheckPort"` is the cross-pack key.
 *   Sibling Session A's adapter declares the same string and Effect
 *   resolves them as the same Tag at composition time.
 *
 * Cycle-Q · 2026-05-04 · sprint-4 SEAMS · SDD §4.3.
 */

import { Context, Effect, Layer } from "effect";
import { type PlayerIdentity } from "@0xhoneyjar/quests-protocol";

// ---------------------------------------------------------------------------
// Cross-pack Tag identity contract — load-bearing constant
// ---------------------------------------------------------------------------

/**
 * The cross-pack Tag identity string. EXACT MATCH required across packages
 * for Effect to resolve them as the same Tag.
 *
 * Sibling Session A's `AuthCheckPortSietchLayer` references this exact
 * string; the cross-pack identity test asserts the literal value.
 */
export const AUTH_CHECK_PORT_TAG_IDENTITY =
  "@freeside-quests/AuthCheckPort" as const;

// ---------------------------------------------------------------------------
// AuthCheck — verifier output shape
// ---------------------------------------------------------------------------

/**
 * Verification error codes emitted by the Sietch Layer (cycle-B sprint-1
 * B-1.9 · AC-B1.9.1). Recoverable JWT failures (malformed token, expired
 * exp, unknown kid that couldn't be refreshed) populate the `verify_error`
 * field on AuthCheck so the bot dispatcher can decide per fail-mode whether
 * to 401 or downgrade-with-audit.
 *
 * Tenant assertion failures are NOT enumerated here — they cause an
 * Effect defect (`Effect.die`) per the I6 invariant + SDD §11.4 + §13.2.
 * Cannot be recovered · cannot fall back to anon · halt processing.
 */
export type VerifyErrorCode =
  | "malformed"
  | "expired"
  | "wrong_audience"
  | "unknown_kid_refresh_failed";

export interface VerifyError {
  readonly code: VerifyErrorCode;
  readonly reason: string;
}

/**
 * Result of an auth check. `is_verified` gates badge issuance per D4.
 * `display_handle` is the resolved canonical handle (used by the renderer
 * Transform 3 wallet→@handle); the default anon adapter leaves it
 * `undefined` and the Sietch adapter populates it.
 *
 * cycle-B sprint-1 B-1.9 · additive: `verify_error` is populated by the
 * Sietch Layer for recoverable JWT verification failures (malformed /
 * expired / wrong audience / unknown kid). Anon Layer never sets it. The
 * bot dispatcher inspects this field per fail-mode classification:
 *
 *   - `verified-required` route + verify_error present → 401 + structured error
 *   - `verified-with-anon-fallback` route + verify_error → audit log + anon
 *   - `public` route → not consulted at all
 *
 * Catastrophic verification failures (tenant assertion mismatch · I6) are
 * NOT surfaced via verify_error — they cause Effect defects and halt the
 * pipeline upstream of any consumer that could check this field.
 */
export interface AuthCheck {
  /** True iff the player is wallet-verified via Sietch /verify. */
  readonly is_verified: boolean;
  /** Resolved canonical handle (for renderer display) — undefined if anon. */
  readonly display_handle?: string;
  /**
   * Recoverable verify failure detail · populated by Sietch Layer only.
   * Anon Layer never sets this field. cycle-B sprint-1 B-1.9 · AC-B1.9.1.
   */
  readonly verify_error?: VerifyError;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

/**
 * AuthCheckPort — single-verb seam between engine + identity substrate.
 *
 * The default adapter never fails (`Effect.Effect<AuthCheck, never>`). When
 * Session A's adapter lands and starts consuming loa-freeside, errors will
 * compose additively without breaking the public surface (consumer code
 * using `Effect.flatMap` over `check(...)` continues to work; sibling can
 * widen the error channel via a new Layer).
 */
export interface AuthCheckPort {
  readonly check: (
    player: PlayerIdentity,
  ) => Effect.Effect<AuthCheck, never>;
}

export const AuthCheckPort = Context.GenericTag<AuthCheckPort>(
  AUTH_CHECK_PORT_TAG_IDENTITY,
);

// ---------------------------------------------------------------------------
// Default adapter — anon-allowed (PRD D4)
// ---------------------------------------------------------------------------

/**
 * Default Layer — derives `is_verified` from the `PlayerIdentity` tag.
 *
 * Per PRD D4 ("open-accept · badge-gated") this means anon players can
 * accept + submit · only verified players' verdicts trigger
 * `BadgeIssuancePort`. The `display_handle` is left undefined so the
 * renderer falls back to the discord-id mention shape until Session A
 * populates it.
 */
export const AuthCheckPortAnonLayer = Layer.succeed(
  AuthCheckPort,
  AuthCheckPort.of({
    check: (player) =>
      Effect.succeed<AuthCheck>({
        is_verified: player.type === "verified",
        display_handle: undefined,
      }),
  }),
);
