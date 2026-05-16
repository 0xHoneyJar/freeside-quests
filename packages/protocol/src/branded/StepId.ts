import { Schema } from "effect";

/**
 * StepId — opaque branded identifier for an ActivityStep.
 *
 * Pattern: `^step_[a-z0-9_-]{1,128}$` (per SDD §5.2 + §3.1)
 *
 * Allows `-` for stable readable step slugs like `step_intro-1`.
 */
export const StepId = Schema.String.pipe(
  Schema.pattern(/^step_[a-z0-9_-]{1,128}$/),
  Schema.brand("StepId"),
);

export type StepId = Schema.Schema.Type<typeof StepId>;
