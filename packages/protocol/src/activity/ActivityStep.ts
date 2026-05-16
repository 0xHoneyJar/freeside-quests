import { Schema } from "effect";

import { StepId } from "../branded/StepId.js";

/**
 * ActivityStep — minimal scaffold (T1.3 dependency stub).
 *
 * **Status**: PLACEHOLDER. The full schema lands in T1.5 (FR-3) and adds
 * `description: string`, `verification: VerificationMethod` (sealed-union of
 * 6 variants), and `required: boolean`. The minimal shape here is just the
 * surface area Activity.steps[] needs at the T1.3 boundary — `step_id` for
 * referencing + `order` for the canonical-preimage tie-break rule (§5.6).
 *
 * Constraints honored by the stub:
 * - **CL-Step-2** (every step verification produces a CompletionEvent
 *   hash-bound to the step) is enforced by the EVENT shape, not here.
 * - **CL-Step-1** (sealed VerificationMethod) is deferred to T1.5.
 *
 * Replacing this stub in T1.5 is additive — adding fields to a Schema.Struct
 * keeps existing decodes valid as long as the field is non-required-via-
 * literal-default OR the bump is gated by `schema_version`.
 */
export const ActivityStep = Schema.Struct({
  step_id: StepId,
  order: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export type ActivityStep = Schema.Schema.Type<typeof ActivityStep>;
