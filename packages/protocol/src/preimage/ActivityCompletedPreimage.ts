import { Schema } from "effect";

import { StepCompletion } from "../activity/ActivityStep.js";
import { ActivityId } from "../branded/ActivityId.js";
import { EventId } from "../branded/EventId.js";
import { IdentityId } from "../branded/IdentityId.js";
import { PeriodKey } from "../branded/PeriodKey.js";
import { preimageEnvelopeFields } from "./PreimageEnvelope.js";

/**
 * ActivityCompletedPreimage — canonical preimage shape for ActivityCompleted
 * (§5.6 · T1.8 · per FR-5 + CL-Event-3).
 *
 * Identical to {@link ActivityCompleted} MINUS the `event_id` field. The
 * `step_completions` array is sorted by `(order, step_id)` lex-ascending
 * BEFORE canonicalization (§5.6 tie-break rule) — this struct declares the
 * shape, the canonical sort is applied at hash time by `computeEventId`.
 */
export const ActivityCompletedPreimage = Schema.Struct({
  ...preimageEnvelopeFields,
  $id: Schema.Literal("https://schemas.freeside.thj/activity-completed/v1.0.0"),
  preimage_schema_id: Schema.Literal(
    "https://schemas.freeside.thj/preimage/activity-completed/v1.0.0",
  ),
  activity_id: ActivityId,
  identity_id: IdentityId,
  period_key: Schema.NullOr(PeriodKey),
  step_completions: Schema.Array(StepCompletion),
  reward_state_id: Schema.NullOr(EventId),
});

export type ActivityCompletedPreimage = Schema.Schema.Type<typeof ActivityCompletedPreimage>;
