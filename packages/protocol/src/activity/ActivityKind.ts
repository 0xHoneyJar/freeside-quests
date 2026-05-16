import { Schema } from "effect";

import { CycleId } from "../branded/CycleId.js";
import { ISOWeek, WorldDefinedKey } from "../branded/PeriodKey.js";
import { SnapshotId } from "../branded/SnapshotId.js";
import { WorldId } from "../branded/WorldId.js";

/**
 * Reserved namespace prefixes that worlds MAY NOT use for their kind_id
 * suffix (per Sprint 1 T1.4 acceptance + §9.1 governance).
 *
 * `freeside-` · `loa-` · `core-` are owned by the substrate authorship layer.
 * Worlds that name a kind beginning with any of these prefixes are rejected
 * at the schema boundary — preserves the substrate-vs-world boundary that
 * architectural lock A1 + extension governance (§9) depend on.
 */
export const RESERVED_KIND_PREFIXES = ["freeside-", "loa-", "core-"] as const;

/** Substrate-enforced format for the world-supplied `<kind>` half of WorldDefined.kind_id. */
const WORLD_KIND_SUFFIX_PATTERN = /^[a-z0-9_-]+$/;

/** Substrate-enforced format for the world-supplied `<world_id>` half of WorldDefined.kind_id. */
const WORLD_NAMESPACE_PATTERN = /^[a-z0-9_-]+$/;

/**
 * WorldDefinedKindId — `<world_id>:<kind>` (per §9.1 namespace convention +
 * T1.4 substrate enforcement).
 *
 * Layered rules (each can reject independently):
 *   1. Total length ≤ 64 chars
 *   2. Pattern `^[a-z0-9_-]+:[a-z0-9_-]+$` (lowercase + digits + `_-` only)
 *   3. Suffix does NOT start with any reserved namespace prefix
 *
 * The substrate does NOT validate the world's sub-schema (CL-ActivityKind-4) —
 * only the namespace seam.
 */
export const WorldDefinedKindId = Schema.String.pipe(
  Schema.maxLength(64),
  Schema.pattern(/^[a-z0-9_-]+:[a-z0-9_-]+$/),
  Schema.filter(
    (s) => {
      const colon = s.indexOf(":");
      if (colon === -1) {
        return "WorldDefinedKindId requires a `<world_id>:<kind>` shape";
      }
      const namespace = s.slice(0, colon);
      const suffix = s.slice(colon + 1);

      if (!WORLD_NAMESPACE_PATTERN.test(namespace) || namespace.length === 0) {
        return "WorldDefinedKindId namespace half must match ^[a-z0-9_-]+$ and be non-empty";
      }
      if (!WORLD_KIND_SUFFIX_PATTERN.test(suffix) || suffix.length === 0) {
        return "WorldDefinedKindId kind half must match ^[a-z0-9_-]+$ and be non-empty";
      }
      for (const prefix of RESERVED_KIND_PREFIXES) {
        if (suffix.startsWith(prefix)) {
          return `WorldDefinedKindId kind half must not start with reserved prefix '${prefix}' (owned by the substrate)`;
        }
      }
      return undefined;
    },
    { identifier: "WorldDefinedKindId" },
  ),
  Schema.brand("WorldDefinedKindId"),
);

export type WorldDefinedKindId = Schema.Schema.Type<typeof WorldDefinedKindId>;

/**
 * Substrate-validated sub_schema_id reference. Worlds register their full
 * sub-schema under their own $id; the substrate only enforces that the
 * reference is a non-empty URI-shaped string. The world is responsible for
 * the schema's actual content (CL-ActivityKind-4).
 */
export const WorldSubSchemaId = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(512),
  Schema.pattern(/^https?:\/\/[^\s]+$/),
);

export type WorldSubSchemaId = Schema.Schema.Type<typeof WorldSubSchemaId>;

/**
 * ActivityKind variants (FR-2 + CL-ActivityKind-1..4 + D19 §9.1).
 *
 * Each variant is a TaggedStruct carrying its variant-specific shape. The
 * top-level {@link ActivityKind} is a Schema.Union over all variants — that's
 * the sealed-discriminator form available in Effect 3.x (TaggedEnum is the
 * pre-3.x name and was removed in favor of TaggedStruct + Union).
 *
 * Variant per-kind period_key shape (CL-Activity-3 · CL-ActivityKind-2):
 *   - Quest         → null
 *   - Mission       → ISOWeek (e.g., "2025-W42")
 *   - BadgeClaim    → null | SnapshotId
 *   - RaffleEntry   → CycleId
 *   - WorldDefined  → world_id + kind_id + sub_schema_id + period_key:null|string
 */
export const ActivityKindQuest = Schema.TaggedStruct("Quest", {
  period_key: Schema.Null,
});

export const ActivityKindMission = Schema.TaggedStruct("Mission", {
  period_key: ISOWeek,
});

export const ActivityKindBadgeClaim = Schema.TaggedStruct("BadgeClaim", {
  period_key: Schema.NullOr(SnapshotId),
});

export const ActivityKindRaffleEntry = Schema.TaggedStruct("RaffleEntry", {
  period_key: CycleId,
});

export const ActivityKindWorldDefined = Schema.TaggedStruct("WorldDefined", {
  world_id: WorldId,
  kind_id: WorldDefinedKindId,
  sub_schema_id: WorldSubSchemaId,
  period_key: Schema.NullOr(WorldDefinedKey),
});

/**
 * ActivityKind — sealed discriminated union over the 5 variants above
 * (FR-2 + CL-ActivityKind-1). The discriminator is `_tag`.
 */
export const ActivityKind = Schema.Union(
  ActivityKindQuest,
  ActivityKindMission,
  ActivityKindBadgeClaim,
  ActivityKindRaffleEntry,
  ActivityKindWorldDefined,
);

export type ActivityKind = Schema.Schema.Type<typeof ActivityKind>;
