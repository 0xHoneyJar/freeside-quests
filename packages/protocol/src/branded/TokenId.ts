import { Schema } from "effect";

/**
 * TokenId — opaque branded identifier for a fungible-token kind (FR-4).
 *
 * Pattern: `^[a-z][a-z0-9_-]{0,127}$` — kebab/snake slug-style ≤128 chars.
 * Used by ActivityReward.TokenAmount; consumers resolve TokenId → on-chain
 * contract via world-supplied resolver (not the substrate's responsibility).
 */
export const TokenId = Schema.String.pipe(
  Schema.pattern(/^[a-z][a-z0-9_-]{0,127}$/),
  Schema.brand("TokenId"),
);

export type TokenId = Schema.Schema.Type<typeof TokenId>;
