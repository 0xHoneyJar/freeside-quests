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
import { type PlayerIdentity } from "@freeside-quests/protocol";

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
 * Result of an auth check. `is_verified` gates badge issuance per D4.
 * `display_handle` is the resolved canonical handle (used by the renderer
 * Transform 3 wallet→@handle); the default anon adapter leaves it
 * `undefined` and Session A populates it.
 */
export interface AuthCheck {
  /** True iff the player is wallet-verified via Sietch /verify. */
  readonly is_verified: boolean;
  /** Resolved canonical handle (for renderer display) — undefined if anon. */
  readonly display_handle?: string;
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
