import { Schema } from "effect";

import { StepCompletion } from "../activity/ActivityStep.js";
import { ActivityId } from "../branded/ActivityId.js";
import { EventId } from "../branded/EventId.js";
import { IdentityId } from "../branded/IdentityId.js";
import { StepId } from "../branded/StepId.js";

/**
 * ProgressLifecycleState — one identity's lifecycle through a single activity
 * (D10 · per SDD §3.2). Distinct from Activity.lifecycle_state (which
 * describes the ACTIVITY's lifecycle) per IMP-015 resolution.
 */
export const ProgressLifecycleState = Schema.Literal("NOT_STARTED", "IN_PROGRESS", "COMPLETED");

export type ProgressLifecycleState = Schema.Schema.Type<typeof ProgressLifecycleState>;

/**
 * ProgressRecord — the per-(activity, identity) state used by ProgressPort
 * (T1.15 · D10 RESOLVED · per SDD §3.2).
 *
 * `version` is the optimistic-concurrency counter (FR-8 ConcurrentUpdate).
 * `steps_completed` is ordered by completion ts (newest last).
 * `last_advanced_event_id` points at the most-recent ProgressAdvanced.
 */
export const ProgressRecord = Schema.Struct({
  activity_id: ActivityId,
  identity_id: IdentityId,
  current_step: Schema.NullOr(StepId),
  steps_completed: Schema.Array(StepCompletion),
  last_advanced_event_id: Schema.NullOr(EventId),
  version: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  lifecycle_state: ProgressLifecycleState,
});

export type ProgressRecord = Schema.Schema.Type<typeof ProgressRecord>;
