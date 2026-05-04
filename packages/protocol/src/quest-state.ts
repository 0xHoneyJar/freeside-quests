/**
 * QuestState schema — per (player, quest) progression record.
 *
 * Sealed v1 per PRD D3 sealed via `Schema.Struct` (no `Schema.partial`).
 * Additive minor bumps allowed (e.g. adding new optional fields for v2
 * multi-step quests).
 *
 * Persistence layer round-trips state through `Schema.decodeUnknown` at
 * every boundary — defense-in-depth against schema drift across deploys.
 *
 * Cycle-Q · 2026-05-04 · sprint-2 ENGINE+PERSIST · SDD §3.2.
 */

import { Schema } from "effect";
import { QuestId, NpcId } from "./quest.js";

// ---------------------------------------------------------------------------
// Phase enum — strictly ordered transitions
// ---------------------------------------------------------------------------

/**
 * Phase enum — strictly ordered. Transitions are pure functions in the
 * state-machine. Adapters MUST persist as string · MUST round-trip
 * through Schema.decodeUnknown at every boundary.
 *
 * Per PRD D3 sealed v1. Per SDD §3.2.
 */
export const QuestPhase = Schema.Literal(
  "browsing", // user has seen quest in /quest browse · no commitment
  "accepted", // user clicked Accept · before any submission
  "submitted", // user submitted text response · awaiting construct judgment
  "judged", // construct returned verdict · before badge dispatch
  "completed", // APPROVED + badge issued (or null badge for anon)
  "failed", // REJECTED · terminal · user may retry as new submission
);
export type QuestPhase = Schema.Schema.Type<typeof QuestPhase>;

// ---------------------------------------------------------------------------
// Branded player identity types
// ---------------------------------------------------------------------------

/**
 * PlayerWallet — lowercased canonical hex.
 * Reused canon from `substrate-step.ts` `SubstrateStepSubmission.walletAddress`.
 * For anon-allowed mode (per PRD D4), wallet is null and discord_id required.
 */
export const PlayerWallet = Schema.String.pipe(
  Schema.brand("PlayerWallet"),
  Schema.pattern(/^0x[a-f0-9]{40}$/),
);
export type PlayerWallet = Schema.Schema.Type<typeof PlayerWallet>;

/** Discord identity (anon-fallback when wallet not verified). */
export const DiscordId = Schema.String.pipe(
  Schema.brand("DiscordId"),
  Schema.pattern(/^\d{17,20}$/),
);
export type DiscordId = Schema.Schema.Type<typeof DiscordId>;

// ---------------------------------------------------------------------------
// PlayerIdentity — discriminated union (verified-OR-anon)
// ---------------------------------------------------------------------------

/**
 * Player identity — verified-OR-anon discriminated union.
 *
 * Per PRD D4 anon-allowed default: anon discord-only access works for
 * acceptance + submission · badge issuance gates on `is_verified` via
 * `AuthCheckPort`. Tagged-union form lets the persistence layer compose
 * a stable composite key (per (quest_id, player_identity)).
 */
export const PlayerIdentity = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("verified"),
    wallet: PlayerWallet,
    discord_id: DiscordId,
  }),
  Schema.Struct({
    type: Schema.Literal("anon"),
    discord_id: DiscordId,
  }),
);
export type PlayerIdentity = Schema.Schema.Type<typeof PlayerIdentity>;

// ---------------------------------------------------------------------------
// VerdictSnapshot — embedded inside QuestState on phase ≥ judged
// ---------------------------------------------------------------------------

/**
 * Verdict snapshot embedded in QuestState — preserves the construct's
 * judgment for renderer display + telemetry.
 *
 * Per [[chat-medium-presentation-boundary]] §2 drift signature: renderer
 * SHOWS narrative + curator_voice_quote · NEVER status enum, NEVER
 * confidence numerals.
 */
export const VerdictSnapshot = Schema.Struct({
  status: Schema.Literal("APPROVED", "REJECTED", "NEEDS_HUMAN"),
  confidence: Schema.Number.pipe(Schema.between(0, 1)),
  /** Curator-voice quote — preserved for renderer · NOT substrate-interpreted. */
  narrative: Schema.String.pipe(Schema.minLength(1)),
  curator_voice_quote: Schema.optional(Schema.String),
});
export type VerdictSnapshot = Schema.Schema.Type<typeof VerdictSnapshot>;

// ---------------------------------------------------------------------------
// QuestState — the persisted progression record
// ---------------------------------------------------------------------------

/**
 * QuestState — per (player, quest) progression record.
 * Sealed v1. Additive minor bumps allowed (e.g. adding new optional fields
 * for v2 multi-step quests).
 */
export const QuestState = Schema.Struct({
  /** Composite primary key: quest_id + player_identity. */
  quest_id: QuestId,
  player: PlayerIdentity,
  /** Denormalized for query convenience — must match Quest.npc_pointer. */
  npc_id: NpcId,
  /** Current phase. */
  phase: QuestPhase,
  /** ISO datetimes — populated as phases advance · undefined for not-yet-reached. */
  accepted_at: Schema.optional(Schema.String),
  submitted_at: Schema.optional(Schema.String),
  judged_at: Schema.optional(Schema.String),
  completed_at: Schema.optional(Schema.String),
  /** Latest verdict (if phase ≥ judged). */
  verdict: Schema.optional(VerdictSnapshot),
  /** Stable URI for badge artifact (post-issuance · undefined if not issued). */
  badge_uri: Schema.optional(Schema.String),
  /**
   * Telemetry only · NEVER user-visible per CMP-boundary §2 drift signature.
   * The substrate-id-leak guard test (sprint-2 Q2.8) asserts this string never
   * leaks into engine string outputs.
   */
  trace_id: Schema.String.pipe(Schema.minLength(1)),
  contract_version: Schema.String.pipe(Schema.pattern(/^\d+\.\d+\.\d+$/)),
});
export type QuestState = Schema.Schema.Type<typeof QuestState>;
