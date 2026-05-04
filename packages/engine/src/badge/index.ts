/**
 * BadgeIssuancePort — produces BadgeArtifact for APPROVED verdicts only.
 *
 * Per [[mibera-as-npc]] §1 two-tier: substrate owns the verifier
 * (state-machine + AuthCheckPort gate) · construct + asset-pipeline own
 * the artifact (prompt seed authored by Track A · Cycle B asset-pipeline
 * generates + mirrors).
 *
 * Default adapter returns `null` (no artifact issued). The production
 * adapter lands when Cycle B asset-pipeline + Track A both ship; until
 * then, the substrate is fully exercisable end-to-end with `null` badges
 * — the state machine, dispatcher, persistence layer, and auth gate are
 * all validated against the full APPROVED → completed path.
 *
 * Per Eileen's no-paying rail: NO on-chain mint flow. Off-chain artifact
 * only. The `BadgeArtifact.uri` is a stable URL per
 * [[metadata-as-integration-contract]] — Cycle B's `AssetService` resolves
 * variants (size · format) at presentation time.
 *
 * IDENTITY CONTRACT (mirrors QuestStatePort architect lock A2):
 *   The string `"@freeside-quests/BadgeIssuancePort"` is the cross-pack key.
 *   Cycle B's adapter declares the same string and Effect resolves them as
 *   the same Tag at composition time.
 *
 * Cycle-Q · 2026-05-04 · sprint-4 SEAMS · SDD §4.4.
 */

import { Context, Effect, Layer } from "effect";
import {
  type Quest,
  type QuestVerdict,
  type PlayerIdentity,
  type BadgeArtifact,
} from "@0xhoneyjar/quests-protocol";

// ---------------------------------------------------------------------------
// Cross-pack Tag identity contract — load-bearing constant
// ---------------------------------------------------------------------------

/**
 * The cross-pack Tag identity string. EXACT MATCH required across packages
 * for Effect to resolve them as the same Tag. Cycle B's
 * `BadgeIssuancePortAssetPipelineLayer` references this exact string.
 */
export const BADGE_ISSUANCE_PORT_TAG_IDENTITY =
  "@freeside-quests/BadgeIssuancePort" as const;

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

/**
 * BadgeIssuancePort — single-verb seam between engine + asset-pipeline.
 *
 * Returns `BadgeArtifact | null`:
 *   - `null` → no artifact issued (default; verified-but-no-pipeline case)
 *   - `BadgeArtifact` → stable URI ready for `state.badge_uri` after
 *     `transitions.finalize`.
 *
 * The default adapter never fails (`Effect.Effect<BadgeArtifact | null,
 * never>`). When Cycle B's adapter lands and starts calling
 * `AssetService.fetchOptimal`, errors will compose additively (sibling can
 * widen the error channel via a new Layer; consumer code is unchanged).
 */
export interface BadgeIssuancePort {
  readonly issue: (
    quest: Quest,
    verdict: QuestVerdict,
    player: PlayerIdentity,
  ) => Effect.Effect<BadgeArtifact | null, never>;
}

export const BadgeIssuancePort = Context.GenericTag<BadgeIssuancePort>(
  BADGE_ISSUANCE_PORT_TAG_IDENTITY,
);

// ---------------------------------------------------------------------------
// Default adapter — null badge (PRD D4 anon path · scaffolding)
// ---------------------------------------------------------------------------

/**
 * Default Layer — always returns `null` (no artifact issued).
 *
 * This is the active Layer until Cycle B asset-pipeline + Track A
 * Mongolian content both ship. It exists for two reasons:
 *
 *   1. PRD D4 anon path — players who haven't `/verify`'d should see a
 *      completed quest with a `null` `badge_uri` (soft conversion path:
 *      they can verify later and retroactively claim the artifact). The
 *      `AuthCheckPort` gate decides which verified players reach this
 *      adapter; this adapter is the no-op fallback for everyone else.
 *
 *   2. Substrate validation — the stub-quest end-to-end test (Q4.3)
 *      drives the full state-machine flow against `null` badges so the
 *      substrate is exercised before Cycle B + Track A productionize the
 *      artifact path.
 */
export const BadgeIssuancePortNullLayer = Layer.succeed(
  BadgeIssuancePort,
  BadgeIssuancePort.of({
    issue: () => Effect.succeed(null),
  }),
);
