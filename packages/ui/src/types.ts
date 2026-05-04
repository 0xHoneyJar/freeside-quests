/**
 * Sprint 1 SCAFFOLD types — minimal local interfaces matching SDD §3 shape.
 *
 * IMPORTANT: These are SCAFFOLD-ONLY interfaces for Sprint 1. Sprint 2 (P2
 * ENGINE+PERSIST) lands the canonical sealed Effect Schemas in
 * `@0xhoneyjar/quests-protocol`. When that lands, this file is DELETED and the
 * imports below switch to:
 *
 *   import type { Quest, QuestState, QuestPhase, QuestVerdict, BadgeArtifact, BadgeSpec }
 *     from "@0xhoneyjar/quests-protocol";
 *
 * The local shapes here are intentionally LOOSE (string aliases) so Sprint 1
 * compiles standalone without contradicting the Sprint 2 sealed schemas. The
 * cross-pack swap is one-line per file.
 */

/** Quest definition shape. Sprint 2 replaces with sealed Effect.Schema. */
export interface Quest {
  readonly quest_id: string;
  readonly slug: string;
  readonly title: string;
  readonly prompt: string;
  readonly badge_spec: BadgeSpec;
}

/** Badge spec attached to a quest definition. */
export interface BadgeSpec {
  readonly slug: string;
  readonly display_name: string;
  readonly description: string;
}

/** Phase enum for QuestState lifecycle. Sprint 2 lands Schema.Literal. */
export type QuestPhase =
  | "browsing"
  | "accepted"
  | "submitted"
  | "judged"
  | "completed";

/** Persisted quest state per player. */
export interface QuestState {
  readonly quest_id: string;
  readonly player_identity: PlayerIdentity;
  readonly phase: QuestPhase;
  readonly accepted_at: string | null;
  readonly submitted_at: string | null;
  readonly judged_at: string | null;
  readonly completed_at: string | null;
}

/** Player identity (anon-allowed per PRD D4). */
export interface PlayerIdentity {
  readonly handle: string;
  readonly wallet: string | null;
  readonly is_verified: boolean;
}

/** Verdict produced by curator. Status enum lives INTERNAL — UI surfaces narrative only. */
export interface QuestVerdict {
  readonly verdict_id: string;
  readonly narrative: string;
  readonly issued_at: string;
}

/** Badge artifact — issued post-completion. */
export interface BadgeArtifact {
  readonly artifact_id: string;
  readonly badge_spec: BadgeSpec;
  readonly image_uri: string;
  readonly issued_at: string;
}
