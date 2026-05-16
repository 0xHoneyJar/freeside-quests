import { Schema } from "effect";

/**
 * CosmeticId — opaque branded identifier for a Cosmetic reward (FR-4).
 *
 * Pattern: `^[a-z][a-z0-9_-]{0,127}$` — kebab/snake slug-style ≤128 chars.
 * The cosmetic's visual/audio content + on-chain referent is the world's
 * responsibility; substrate carries the identifier only.
 */
export const CosmeticId = Schema.String.pipe(
  Schema.pattern(/^[a-z][a-z0-9_-]{0,127}$/),
  Schema.brand("CosmeticId"),
);

export type CosmeticId = Schema.Schema.Type<typeof CosmeticId>;
