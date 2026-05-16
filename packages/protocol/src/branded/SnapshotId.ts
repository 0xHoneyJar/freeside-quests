import { Schema } from "effect";

/**
 * SnapshotId — opaque branded identifier for a point-in-time snapshot.
 *
 * Pattern: `^snap_[a-z0-9]{1,128}$` (per SDD §5.2 + §3.1)
 *
 * Composes into {@link PeriodKey} as a snapshot-scoped period identifier.
 */
export const SnapshotId = Schema.String.pipe(
  Schema.pattern(/^snap_[a-z0-9]{1,128}$/),
  Schema.brand("SnapshotId"),
);

export type SnapshotId = Schema.Schema.Type<typeof SnapshotId>;
