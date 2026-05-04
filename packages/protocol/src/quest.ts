/**
 * Quest schema — the canonical entity. A quest is a single offering by ONE
 * NPC to ANY player. Mongolian is the first instance (cycle-3).
 *
 * Per [[mibera-as-npc]] §1 two-tier: substrate owns the IDENTITY (this
 * schema) and the VERIFIER (state-machine). Construct owns the VOICE
 * (rubric_pointer is the curator-authored content the construct grades
 * against — opaque to substrate · per SDD §3.1 + architect lock A4).
 *
 * Cycle-Q · 2026-05-04 · sprint-2 ENGINE+PERSIST.
 */

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Branded types
// ---------------------------------------------------------------------------

/** Branded UUID — quests have stable IDs across all consumers. */
export const QuestId = Schema.String.pipe(
  Schema.brand("QuestId"),
  Schema.minLength(1),
);
export type QuestId = Schema.Schema.Type<typeof QuestId>;

/** NPC pointer — kebab-case slug. e.g. "mongolian", "satoshi-grail". */
export const NpcId = Schema.String.pipe(
  Schema.brand("NpcId"),
  Schema.pattern(/^[a-z][a-z0-9-]*$/),
);
export type NpcId = Schema.Schema.Type<typeof NpcId>;

/** Stable badge family identifier (e.g. "mongolian-petroglyph"). */
export const BadgeFamilyId = Schema.String.pipe(
  Schema.brand("BadgeFamilyId"),
  Schema.minLength(1),
);
export type BadgeFamilyId = Schema.Schema.Type<typeof BadgeFamilyId>;

/** Per-world namespace slug — kebab-case · matches world-manifest world_slug. */
export const WorldSlug = Schema.String.pipe(
  Schema.brand("WorldSlug"),
  Schema.pattern(/^[a-z][a-z0-9-]*$/),
);
export type WorldSlug = Schema.Schema.Type<typeof WorldSlug>;

// ---------------------------------------------------------------------------
// Rubric pointer — discriminated union (architect lock A4)
// ---------------------------------------------------------------------------

/**
 * Pointer into rubric authored by curator. URL or codex ref.
 * The construct dereferences; substrate does NOT interpret.
 * Per [[chathead-in-cache-pattern]]: rubric lives in metadata-mutable layer.
 *
 * Architect lock A4 (SDD §1.5): substrate NEVER interprets the rubric · only
 * the construct (LLM-bound) does.
 */
export const RubricPointer = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("url"),
    url: Schema.String.pipe(Schema.minLength(1)),
  }),
  Schema.Struct({
    type: Schema.Literal("codex_ref"),
    construct_slug: Schema.String,
    cell_id: Schema.String,
  }),
);
export type RubricPointer = Schema.Schema.Type<typeof RubricPointer>;

// ---------------------------------------------------------------------------
// Badge spec — what artifact gets issued on APPROVED verdict
// ---------------------------------------------------------------------------

/**
 * Badge spec — what artifact gets issued on APPROVED verdict.
 * Per Eileen's no-paying rail: off-chain artifact only · NO mint flow.
 * Composes with Cycle B asset-pipeline at `BadgeIssuancePort` adapter.
 */
export const BadgeSpec = Schema.Struct({
  /** Stable ID for the badge family (e.g. "mongolian-petroglyph"). */
  family_id: BadgeFamilyId,
  /** Display name shown in chat (e.g. "The Steppe's Mark"). */
  display_name: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(60),
  ),
  /** Curator-authored prompt seed (Track A · Gumi authors for Mongolian). */
  prompt_seed: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(500),
  ),
  /** Format hint — substrate doesn't enforce; renderer/asset-pipeline picks. */
  format_hint: Schema.optional(
    Schema.Literal("png", "webp", "gif", "mp4"),
  ),
});
export type BadgeSpec = Schema.Schema.Type<typeof BadgeSpec>;

// ---------------------------------------------------------------------------
// Quest entity — sealed shape
// ---------------------------------------------------------------------------

/** The Quest — sealed shape per SDD §3.1. */
export const Quest = Schema.Struct({
  quest_id: QuestId,
  /** NPC offering this quest. Maps 1:1 to character pack slug. */
  npc_pointer: NpcId,
  /** World namespace. Per PRD D5: per-world quest namespace. */
  world_slug: WorldSlug,
  /** User-visible quest title — per [[discord-native-register]] ≤80 chars. */
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  /**
   * User-visible quest prompt — per [[discord-native-register]] ≤180 words
   * for digest budget · ≤1200 chars hard cap.
   */
  prompt: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1200)),
  /** Curator-authored rubric reference (substrate does NOT interpret). */
  rubric_pointer: RubricPointer,
  /** What badge gets issued on APPROVED. */
  badge_spec: BadgeSpec,
  /** ISO datetime when quest was published. */
  published_at: Schema.String,
  /** Single-step v1 · multi-step adds Schema.Array<QuestStep> additively v2. */
  step_count: Schema.Literal(1),
  /** Semver — per substrate-step ABI versioning convention. */
  contract_version: Schema.String.pipe(Schema.pattern(/^\d+\.\d+\.\d+$/)),
});
export type Quest = Schema.Schema.Type<typeof Quest>;

// ---------------------------------------------------------------------------
// Contract version
// ---------------------------------------------------------------------------

/**
 * Quest contract version. Cycle-Q substrate (2026-05-04). Bumps follow
 * loa-constructs/.claude/schemas/VERSIONING.md governance: enum-locked,
 * additive-only minors, major bumps require new file + migration plan.
 */
export const QUEST_CONTRACT_VERSION = "1.0.0" as const;
