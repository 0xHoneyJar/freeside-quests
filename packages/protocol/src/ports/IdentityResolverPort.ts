import type { Effect } from "effect";
import { Schema } from "effect";

import { IdentityId } from "../branded/IdentityId.js";

/**
 * IdentityResolverError — sealed TaggedStruct union for resolver failures
 * (FR-8 · CL-Port-2 · per PRD §FR-8 + FR-12).
 *
 * Variants:
 *   - UnresolvableIdentity → IdentityId is known but no chain address present
 *   - ChainNotSupported    → caller asked for a chain the resolver doesn't index
 *   - ResolverUnavailable  → upstream resolver unreachable
 */
export const IdentityUnresolvableIdentity = Schema.TaggedStruct("UnresolvableIdentity", {
  identity_id: IdentityId,
});

export const IdentityChainNotSupported = Schema.TaggedStruct("ChainNotSupported", {
  chain: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64)),
});

export const IdentityResolverUnavailable = Schema.TaggedStruct("ResolverUnavailable", {
  resolver_id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  reason: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512)),
});

export const IdentityResolverError = Schema.Union(
  IdentityUnresolvableIdentity,
  IdentityChainNotSupported,
  IdentityResolverUnavailable,
);

export type IdentityResolverError = Schema.Schema.Type<typeof IdentityResolverError>;

/**
 * ChainAddress — opaque branded chain address. Substrate does NOT validate
 * chain-specific shape (EVM 0x40 / SVM base58 / etc) — that's the world's
 * resolver's responsibility (architectural lock A5).
 */
export const ChainAddress = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(256),
  Schema.brand("ChainAddress"),
);

export type ChainAddress = Schema.Schema.Type<typeof ChainAddress>;

/**
 * IdentityResolverPort — the substrate identity boundary (architectural
 * lock A5 · per PRD §FR-8 + §FR-12 + SDD §3).
 *
 * Identity is OPAQUE at the substrate boundary. This port is the ONE place
 * a chain address may be looked up; world adapters bind to a real resolver
 * (Dynamic SDK · Privy · custom) while in-memory tests use a Map-backed stub.
 *
 * Constraints (per FR-12):
 *   - CL-Identity-3: an IdentityId can map to MULTIPLE chains (resolveToChainAddress
 *     receives `chain` parameter)
 *   - CL-Identity-4: reverse resolution (chain address → IdentityId) MUST be
 *     consistent — if A resolves to B forward, B resolves back to A
 */
export interface IdentityResolverPort {
  readonly resolveToChainAddress: (
    identity: IdentityId,
    chain: string,
  ) => Effect.Effect<ChainAddress, IdentityResolverError>;
  readonly resolveFromChainAddress: (
    address: ChainAddress,
    chain: string,
  ) => Effect.Effect<IdentityId, IdentityResolverError>;
}
