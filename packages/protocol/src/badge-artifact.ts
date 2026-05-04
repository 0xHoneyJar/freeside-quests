/**
 * BadgeArtifact schema — the issued artifact (post-issuance).
 *
 * Per [[metadata-as-integration-contract]]: stable URL is the contract;
 * variants resolve at presentation time per CMP-boundary doctrine.
 *
 * Per Cycle B asset-pipeline (when it lands): the AssetService will
 * produce variants from this stable URI. This schema does NOT bake
 * variant-format choice into substrate.
 *
 * Cycle-Q · 2026-05-04 · sprint-2 ENGINE+PERSIST · SDD §3.5.
 */

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Branded URI
// ---------------------------------------------------------------------------

/** Stable URI for the issued badge artifact. */
export const BadgeURI = Schema.String.pipe(
  Schema.brand("BadgeURI"),
  Schema.minLength(1),
);
export type BadgeURI = Schema.Schema.Type<typeof BadgeURI>;

// ---------------------------------------------------------------------------
// BadgeArtifact — sealed shape
// ---------------------------------------------------------------------------

export const BadgeArtifact = Schema.Struct({
  /** Stable URI · per metadata-as-integration-contract. */
  uri: BadgeURI,
  /** Format the construct generated (NOT what consumer should display). */
  generated_format: Schema.Literal("png", "webp", "gif", "mp4"),
  /** Curator-authored seed used to generate (audit trail · NOT user-visible). */
  prompt_seed_used: Schema.String,
  /**
   * Per-completion params (color, mood, etc.) — operator-mutable post-issuance
   * per [[continuous-metadata-as-daemon-substrate]] L3 layer mutability.
   */
  per_completion_params: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String }),
  ),
  issued_at: Schema.String,
});
export type BadgeArtifact = Schema.Schema.Type<typeof BadgeArtifact>;
