import { Schema } from "effect";
import { StepCompletion } from "../activity/ActivityStep.js";
import { ActivityId } from "../branded/ActivityId.js";
import { IdentityId } from "../branded/IdentityId.js";
import { eventEnvelopeFields } from "./EventEnvelope.js";

/**
 * ProgressAdvanced — emitted when an identity completes one or more steps
 * of an Activity but the Activity itself is not yet COMPLETED (FR-8 ·
 * D10 ProgressRecord drives off this).
 *
 * Carries the delta — newly completed steps — plus the new optimistic-
 * concurrency version counter for the ProgressRecord (CL-Progress-1).
 */
export const ProgressAdvanced = Schema.Struct({
  ...eventEnvelopeFields,
  $id: Schema.Literal("https://schemas.freeside.thj/progress-advanced/v1.0.0"),
  preimage_schema_id: Schema.Literal(
    "https://schemas.freeside.thj/preimage/progress-advanced/v1.0.0",
  ),
  activity_id: ActivityId,
  identity_id: IdentityId,
  new_step_completions: Schema.Array(StepCompletion),
  version_before: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  version_after: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export type ProgressAdvanced = Schema.Schema.Type<typeof ProgressAdvanced>;
