import { Schema } from "effect";

/**
 * MintIntentId — forward-compat REFERENCE to freeside-mint (per SDD §3.1).
 *
 * Sibling module `freeside-mint` ships in a separate cycle post-acvp-modules-genesis.
 * This brand exists to type cross-module references in event payloads without
 * pulling in the freeside-mint dependency. The real authority for MintIntent
 * objects lives in `freeside-mint`.
 *
 * Pattern: `^mint_[a-z0-9]{1,128}$`
 */
export const MintIntentId = Schema.String.pipe(
  Schema.pattern(/^mint_[a-z0-9]{1,128}$/),
  Schema.brand("MintIntentId"),
);

export type MintIntentId = Schema.Schema.Type<typeof MintIntentId>;
