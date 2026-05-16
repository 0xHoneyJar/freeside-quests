import { Schema } from "effect";

/**
 * WorldId — namespace anchor for a world's Activity catalog.
 *
 * Pattern: `^world_[a-z0-9_-]{1,64}$` (per SDD §3.1)
 *
 * Used as the scope prefix for WorldDefined ActivityKinds (FR-2 · §9.1).
 */
export const WorldId = Schema.String.pipe(
  Schema.pattern(/^world_[a-z0-9_-]{1,64}$/),
  Schema.brand("WorldId"),
);

export type WorldId = Schema.Schema.Type<typeof WorldId>;
