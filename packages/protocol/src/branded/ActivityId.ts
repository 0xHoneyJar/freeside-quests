import { Schema } from "effect";

/**
 * ActivityId — opaque branded identifier for an Activity definition.
 *
 * Pattern: `^act_[a-z0-9]{1,128}$` (per SDD §5.2)
 *
 * Constructor discipline: raw strings are rejected at the schema boundary.
 * Cross-module callers MUST decode through {@link ActivityId} or one of the
 * Effect.Schema decoders that wrap it.
 */
export const ActivityId = Schema.String.pipe(
  Schema.pattern(/^act_[a-z0-9]{1,128}$/),
  Schema.brand("ActivityId"),
);

export type ActivityId = Schema.Schema.Type<typeof ActivityId>;
