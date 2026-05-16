import type { Effect } from "effect";
import { Schema } from "effect";

import { ActivityId } from "../branded/ActivityId.js";
import { IdentityId } from "../branded/IdentityId.js";
import type { ProgressAdvanced } from "../events/ProgressAdvanced.js";
import type { ProgressRecord } from "./ProgressRecord.js";

/**
 * ProgressError — sealed TaggedStruct union of failure modes for ProgressPort
 * operations (FR-8 · CL-Port-2 · per PRD §FR-8).
 *
 * Variants:
 *   - ActivityNotFound   → activity id does not exist in the catalog
 *   - IdentityNotFound   → identity id does not exist in the resolver
 *   - ConcurrentUpdate   → optimistic-concurrency check failed (D10 version mismatch)
 *   - AdapterUnavailable → upstream adapter unreachable (network/db/etc)
 */
export const ProgressActivityNotFound = Schema.TaggedStruct("ActivityNotFound", {
  activity_id: ActivityId,
});

export const ProgressIdentityNotFound = Schema.TaggedStruct("IdentityNotFound", {
  identity_id: IdentityId,
});

export const ProgressConcurrentUpdate = Schema.TaggedStruct("ConcurrentUpdate", {
  activity_id: ActivityId,
  current_version: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  attempted_version: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export const ProgressAdapterUnavailable = Schema.TaggedStruct("AdapterUnavailable", {
  adapter_id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  reason: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512)),
});

export const ProgressError = Schema.Union(
  ProgressActivityNotFound,
  ProgressIdentityNotFound,
  ProgressConcurrentUpdate,
  ProgressAdapterUnavailable,
);

export type ProgressError = Schema.Schema.Type<typeof ProgressError>;

/**
 * ProgressPort — Effect-returning interface for ProgressRecord I/O.
 *
 * Per CL-Port-1: every operation returns Effect<R, E> · NO bare throws.
 * Per CL-Port-2: every error variant MUST be reachable in adapter tests.
 *
 * Adapters in_memory + production implement this interface and run the
 * canonical conformance suite (`progress.conformance.test.ts`).
 */
export interface ProgressPort {
  readonly getProgress: (
    activityId: ActivityId,
    identityId: IdentityId,
  ) => Effect.Effect<ProgressRecord, ProgressError>;
  readonly advanceProgress: (
    event: ProgressAdvanced,
  ) => Effect.Effect<ProgressRecord, ProgressError>;
}
