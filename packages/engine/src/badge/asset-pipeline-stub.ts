/**
 * BadgeIssuancePort asset-pipeline-stub — TODO swap-shape for Cycle B.
 *
 * @future cycle-b-asset-pipeline-substrate — Cycle B
 *   (`@freeside-storage/asset-pipeline`) ships `AssetService.fetchOptimal`
 *   per its PRD. The production adapter wraps that surface to generate
 *   the badge image from `Quest.badge_spec.prompt_seed_pointer`, mirror
 *   it to the per-world CDN per [[metadata-as-integration-contract]], and
 *   return the resolved stable URI as `BadgeArtifact`.
 *
 * @future construct-mibera-codex#76 — Track A (Gumi) authors the
 *   Mongolian-specific `badge_spec.prompt_seed_pointer` content. The
 *   production adapter slots Track A's prompt seed into Cycle B's
 *   asset-pipeline. Until both land, this stub Layer marks the wire-up
 *   point.
 *
 * Per SDD §4.4 + §10 swap-shape pattern: same Tag identity
 * (`@freeside-quests/BadgeIssuancePort`), different Layer. Bot consumer
 * changes ZERO lines to adopt — only the composition root flips Layers.
 *
 * The default `BadgeIssuancePortNullLayer` (in `index.ts`) is the active
 * Layer until Cycle B + Track A both ship.
 *
 * Cycle-Q · 2026-05-04 · sprint-4 SEAMS · SDD §4.4.
 */

import { Effect, Layer } from "effect";

import { BadgeIssuancePort } from "./index.js";

// ---------------------------------------------------------------------------
// Stub Layer — every issue() fails fast with a structured error
// ---------------------------------------------------------------------------

/**
 * Asset-pipeline-stub Layer. Returns an `Effect.die` payload tagged for
 * grep — Cycle B + Track A replace this whole Layer with one that calls
 * `AssetService.fetchOptimal` against Track A's prompt seed.
 *
 * @future cycle-b-asset-pipeline-substrate — when this Layer is composed
 *   at the bot composition root, it MUST be replaced with the real
 *   asset-pipeline adapter before deployment. The stub exists only to
 *   mark where the real adapter slots in.
 */
export const BadgeIssuancePortAssetPipelineStubLayer = Layer.succeed(
  BadgeIssuancePort,
  BadgeIssuancePort.of({
    issue: () =>
      // @future cycle-b-asset-pipeline-substrate — swap to
      //   `assetService.fetchOptimal(quest.badge_spec.prompt_seed_pointer, ...)`
      //   once Cycle B's `@freeside-storage/asset-pipeline` ships.
      Effect.die(
        new Error(
          "BadgeIssuancePortAssetPipelineStubLayer: Cycle B + Track A " +
            "adapter not yet wired. Compose `BadgeIssuancePortNullLayer` " +
            "(default) for now or the real asset-pipeline Layer when " +
            "cycle-b-asset-pipeline-substrate lands.",
        ),
      ),
  }),
);
