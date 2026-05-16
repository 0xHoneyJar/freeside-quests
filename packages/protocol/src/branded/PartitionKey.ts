import { Schema } from "effect";

/**
 * PartitionKey — addresses a monotonic-sequence partition in the event store
 * (FR-11 · per SDD §4.2 + IMP-016 resolution).
 *
 * The `scope` field determines monotonic-sequence grouping. The `composite`
 * scope MUST carry a `<a>::<b>` shape value (T1.20 enforcement); other
 * scopes accept a free-form 1..256-char value (each scope's downstream
 * adapter further constrains).
 */
export const PartitionScope = Schema.Literal(
  "activity",
  "identity",
  "world",
  "event-type",
  "composite",
);

export type PartitionScope = Schema.Schema.Type<typeof PartitionScope>;

/**
 * Composite-value shape: `<part_a>::<part_b>` where each part matches
 * `[a-z][a-z0-9_-]*` (slug-style · ≤120 chars per half · ≤256 total).
 *
 * Per IMP-016: composite supports `world_id::activity_id` style — first half
 * is the namespace/scope, second is the entity within that scope.
 */
const COMPOSITE_VALUE_PATTERN = /^[a-z][a-z0-9_-]{0,119}::[a-z][a-z0-9_-]{0,119}$/;

export const PartitionKey = Schema.Struct({
  scope: PartitionScope,
  value: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),
}).pipe(
  Schema.filter(
    (pk) => {
      if (pk.scope === "composite" && !COMPOSITE_VALUE_PATTERN.test(pk.value)) {
        return "composite-scope value MUST match `<a>::<b>` (slug-style, each half ≤120 chars)";
      }
      return undefined;
    },
    { identifier: "PartitionKey" },
  ),
  Schema.brand("PartitionKey"),
);

export type PartitionKey = Schema.Schema.Type<typeof PartitionKey>;
