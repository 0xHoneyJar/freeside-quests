import { Schema } from "effect";

/**
 * PartitionKey — addresses a monotonic-sequence partition in the event store
 * (FR-11 · per SDD §4.2 + IMP-016 resolution).
 *
 * The `scope` field determines monotonic-sequence grouping. The `composite`
 * scope supports `world_id::activity_id` style composite values; T1.20
 * adds the composite-shape validator on top of this base schema.
 */
export const PartitionScope = Schema.Literal(
  "activity",
  "identity",
  "world",
  "event-type",
  "composite",
);

export type PartitionScope = Schema.Schema.Type<typeof PartitionScope>;

export const PartitionKey = Schema.Struct({
  scope: PartitionScope,
  value: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),
}).pipe(Schema.brand("PartitionKey"));

export type PartitionKey = Schema.Schema.Type<typeof PartitionKey>;
