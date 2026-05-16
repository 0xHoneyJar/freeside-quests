import { Schema } from "effect";

/**
 * PartnerId — opaque branded identifier for an external integration partner.
 *
 * Used inside VerificationMethod.PartnerApi (FR-3) to address a registered
 * partner the substrate calls out to. Pattern is the same kebab-style as
 * other slug brands so partner ids are URL-safe + cross-runtime stable.
 *
 * Pattern: `^[a-z][a-z0-9-]{0,63}$` (starts with letter · ≤64 chars total)
 */
export const PartnerId = Schema.String.pipe(
  Schema.pattern(/^[a-z][a-z0-9-]{0,63}$/),
  Schema.brand("PartnerId"),
);

export type PartnerId = Schema.Schema.Type<typeof PartnerId>;
