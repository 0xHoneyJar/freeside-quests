import { Schema } from "effect";

/**
 * CycleId — opaque branded identifier for a development cycle.
 *
 * Pattern: `^cyc_[a-z0-9_-]{1,128}$` (per SDD §5.2 + §3.1)
 *
 * Composes into {@link PeriodKey} as a cycle-scoped period identifier.
 * Allows `-` to accommodate cycle slugs like `cyc_acvp-modules-genesis`.
 */
export const CycleId = Schema.String.pipe(
  Schema.pattern(/^cyc_[a-z0-9_-]{1,128}$/),
  Schema.brand("CycleId"),
);

export type CycleId = Schema.Schema.Type<typeof CycleId>;
