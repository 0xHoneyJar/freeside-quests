/**
 * EngineConfig — per-world quest engine configuration.
 *
 * Sealed `Schema.Struct` — additive evolution only. Per PRD D4 +
 * SDD §4.5, this carries:
 *   - `questAcceptanceMode` — 3-mode enum gating accept + badge paths
 *   - `worldSlug` — per-world namespace (matches Quest.world_slug)
 *   - `submissionStyle` — inline-thread vs modal-form (per ARCADE D2)
 *   - `positiveFrictionDelayMs` — context-aware delay (CHI'26 Labor Illusion)
 *
 * Per Karpathy "Simplicity First": these are the ONLY config knobs for
 * this cycle. Future fields evolve via additive Schema.Struct extensions
 * (sealed-struct contract per `[[schema-is-not-the-contract]]` — adding
 * a field is additive but consumers must round-trip-decode to opt in).
 *
 * Cycle-Q · 2026-05-04 · sprint-4 SEAMS · SDD §4.5.
 */

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// QuestAcceptanceMode — 3-mode enum (PRD D4)
// ---------------------------------------------------------------------------

/**
 * Quest acceptance mode (3 modes per PRD D4):
 *
 *   - `'open'` — anon-allowed accept · NO badge gate. Anyone who DM'd or
 *     mentioned the NPC can accept and submit; on APPROVED, the
 *     `BadgeIssuancePort` adapter runs unconditionally. Use for casual
 *     events / playtests where the badge is pure participation.
 *
 *   - `'auth-required'` — wallet-verified accept. Anon players see a soft
 *     verify-prompt instead of the accept button. Use for cycles where
 *     the rubric assumes wallet-bound state (e.g. "show me your honeypot
 *     balance").
 *
 *   - `'open-badge-gated'` — DEFAULT (per PRD D4 + Eileen's no-paying
 *     rail). Anon-allowed accept + submit; `AuthCheckPort` consulted at
 *     badge-issuance time. Verified players get `badge_uri` populated;
 *     anon players get `null` badge with retroactive-claim path on
 *     `/verify` later.
 */
export const QuestAcceptanceMode = Schema.Literal(
  "open",
  "auth-required",
  "open-badge-gated",
);
export type QuestAcceptanceMode = Schema.Schema.Type<typeof QuestAcceptanceMode>;

// ---------------------------------------------------------------------------
// SubmissionStyle — inline thread vs modal form (per ARCADE D2)
// ---------------------------------------------------------------------------

/**
 * Submission style:
 *   - `'inline_thread'` — DM-feel · message in spawned thread is the
 *     submission · default for Mongolian.
 *   - `'modal_form'` — Discord modal with structured fields · default for
 *     quests that need typed intake.
 */
export const SubmissionStyle = Schema.Literal("inline_thread", "modal_form");
export type SubmissionStyle = Schema.Schema.Type<typeof SubmissionStyle>;

// ---------------------------------------------------------------------------
// EngineConfig — sealed struct
// ---------------------------------------------------------------------------

export const EngineConfig = Schema.Struct({
  /**
   * Per PRD D4 — DEFAULT `'open-badge-gated'`. Sibling
   * `mature-freeside-operator-sprint-1` adapter swaps in a real auth
   * check; this default works without that adapter (anon-allowed surface
   * is fully functional out of the box).
   */
  questAcceptanceMode: QuestAcceptanceMode,

  /** Per PRD D5 · per-world quest namespace (matches Quest.world_slug). */
  worldSlug: Schema.String.pipe(Schema.pattern(/^[a-z][a-z0-9-]*$/)),

  /**
   * Inline-vs-modal submission style (per ARCADE pair-decision D2).
   * Mongolian's value lands at character-mongolian/persona.yaml feature
   * flag (Track A authors).
   */
  submissionStyle: SubmissionStyle,

  /**
   * Positive-friction cadence ms (per kickoff §9.5 principle 1).
   *   `0` = no delay (test default · disables CHI'26 Labor Illusion).
   *   `9000-15000` = context-aware delay (production target).
   *
   * Mongolian's value lands at character-mongolian/persona.yaml.
   */
  positiveFrictionDelayMs: Schema.Number.pipe(Schema.between(0, 30000)),
});
export type EngineConfig = Schema.Schema.Type<typeof EngineConfig>;

// ---------------------------------------------------------------------------
// Default factory — DEFAULT mode + sensible per-world overrides
// ---------------------------------------------------------------------------

/**
 * Build the default `EngineConfig` for a world. The DEFAULT
 * `questAcceptanceMode` is `'open-badge-gated'` per PRD D4; consumers
 * override via `world.quest_engine_config.questAcceptanceMode` in the
 * world-manifest.
 *
 * Per SDD §6.4: the bot composes this at startup from the world-manifest
 * v1.1's `quest_engine_config` block (sprint-3 Q3.1 lands the schema
 * additive bump).
 */
export const defaultEngineConfig = (
  worldSlug: string,
): EngineConfig =>
  Schema.decodeUnknownSync(EngineConfig)({
    questAcceptanceMode: "open-badge-gated",
    worldSlug,
    submissionStyle: "inline_thread",
    positiveFrictionDelayMs: 0,
  });
