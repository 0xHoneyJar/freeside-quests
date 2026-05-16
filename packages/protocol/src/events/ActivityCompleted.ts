import { Schema } from "effect";
import { StepCompletion } from "../activity/ActivityStep.js";
import { ActivityId } from "../branded/ActivityId.js";
import { EventId } from "../branded/EventId.js";
import { IdentityId } from "../branded/IdentityId.js";
import { PeriodKey } from "../branded/PeriodKey.js";
import { eventEnvelopeFields } from "./EventEnvelope.js";

/**
 * ActivityCompleted — emitted when all required steps of an Activity are
 * verified for a given identity (FR-5 · CL-Event-1).
 *
 * Per PRD §FR-5 the schema_version + $id + preimage_schema_id are LITERAL
 * — they pin this event type's identity. Step completions are sorted by
 * (order, step_id) lex BEFORE canonicalization (§5.6 tie-break rule).
 */
export const ActivityCompleted = Schema.Struct({
  ...eventEnvelopeFields,
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

export type ActivityCompleted = Schema.Schema.Type<typeof ActivityCompleted>;
