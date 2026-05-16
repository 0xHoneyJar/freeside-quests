import { Schema } from "effect";

/**
 * IdentityId — opaque branded identifier for a substrate identity (FR-12).
 *
 * Pattern: `^id_[a-z0-9]{1,128}$` (per SDD §5.2 + §3.1)
 *
 * Identity is OPAQUE at the substrate boundary (architectural lock A5).
 * Chain-address resolution lives behind {@link IdentityResolverPort}.
 */
export const IdentityId = Schema.String.pipe(
  Schema.pattern(/^id_[a-z0-9]{1,128}$/),
  Schema.brand("IdentityId"),
);

export type IdentityId = Schema.Schema.Type<typeof IdentityId>;
