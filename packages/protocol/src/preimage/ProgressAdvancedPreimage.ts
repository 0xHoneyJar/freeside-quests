import { Schema } from "effect";

import { StepCompletion } from "../activity/ActivityStep.js";
import { ActivityId } from "../branded/ActivityId.js";
import { IdentityId } from "../branded/IdentityId.js";
import { preimageEnvelopeFields } from "./PreimageEnvelope.js";

/**
 * ProgressAdvancedPreimage — canonical preimage shape for ProgressAdvanced
 * (§5.6 · T1.8 · per FR-8).
 *
 * Identical to {@link ProgressAdvanced} MINUS the `event_id` field. The
 * `new_step_completions` array follows the same canonical sort rule as
 * `ActivityCompletedPreimage.step_completions` — `(order, step_id)` lex
 * BEFORE hashing.
 */
export const ProgressAdvancedPreimage = Schema.Struct({
  ...preimageEnvelopeFields,
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

export type ProgressAdvancedPreimage = Schema.Schema.Type<typeof ProgressAdvancedPreimage>;
