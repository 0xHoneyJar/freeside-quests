import { Effect } from "effect";

import {
  type ChainAddress,
  IdentityChainNotSupported,
  type IdentityId,
  type IdentityResolverError,
  type IdentityResolverPort,
  IdentityResolverUnavailable,
  IdentityUnresolvableIdentity,
} from "@0xhoneyjar/quests-protocol";

/**
 * Initial binding seed for {@link makeInMemoryIdentityResolver}.
 * Forward mapping: IdentityId × chain → ChainAddress.
 * Reverse mapping is derived automatically — invariant CL-Identity-4.
 *
 * Storing the same `address` under the same chain for two distinct
 * IdentityIds is a configuration bug; the constructor throws if detected
 * because it would break reverse-resolution consistency.
 */
export interface IdentityBinding {
  readonly identity_id: IdentityId;
  readonly chain: string;
  readonly address: ChainAddress;
}

export interface InMemoryIdentityResolverConfig {
  readonly bindings?: ReadonlyArray<IdentityBinding>;
  /**
   * Chains the resolver is configured to support. Forward / reverse calls
   * for a chain outside this set fail with ChainNotSupported (CL-Port-2
   * reachability + FR-12 CL-Identity-3). Omitting it means "all chains".
   */
  readonly supportedChains?: ReadonlySet<string>;
  readonly resolverId?: string;
  readonly simulatedFailures?: ReadonlyArray<{
    readonly on: "resolveToChainAddress" | "resolveFromChainAddress" | "any";
    readonly reason: string;
  }>;
}

export interface InMemoryIdentityResolverHandle {
  readonly port: IdentityResolverPort;
  readonly bind: (binding: IdentityBinding) => void;
  readonly clear: () => void;
}

/**
 * makeInMemoryIdentityResolver — TEST-FIXTURE-ONLY identity resolver
 * (T2.5 · SDD §3.3 · architectural lock A5).
 *
 * NEVER deploy this to production. Identity in production binds to a
 * real resolver (Dynamic SDK · Privy · custom). This stub exists ONLY
 * to let unit tests + the golden-replay test exercise port consumers
 * without standing up a full identity stack.
 *
 * Invariants enforced:
 *   - CL-Port-1: never throws after construction; all I/O is Effect.
 *   - CL-Port-2: every IdentityResolverError variant is reachable.
 *   - CL-Identity-3: a single IdentityId can map to multiple chains.
 *   - CL-Identity-4: reverse resolution is consistent — if A resolves to
 *     B forward on chain X, B resolves back to A on chain X.
 */
export const makeInMemoryIdentityResolver = (
  config: InMemoryIdentityResolverConfig = {},
): InMemoryIdentityResolverHandle => {
  const resolverId = config.resolverId ?? "in-memory:identity-resolver";

  // forward: chain → (identity_id → address)
  const forward = new Map<string, Map<string, ChainAddress>>();
  // reverse: chain → (address → identity_id)
  const reverse = new Map<string, Map<string, IdentityId>>();

  const pendingFailures = [...(config.simulatedFailures ?? [])];

  const consumeSimulatedFailure = (
    op: "resolveToChainAddress" | "resolveFromChainAddress",
  ): string | null => {
    const idx = pendingFailures.findIndex((f) => f.on === op || f.on === "any");
    if (idx === -1) return null;
    const failure = pendingFailures[idx]!;
    pendingFailures.splice(idx, 1);
    return failure.reason;
  };

  const chainSupported = (chain: string): boolean =>
    config.supportedChains === undefined || config.supportedChains.has(chain);

  const bindOne = (b: IdentityBinding): void => {
    let chainForward = forward.get(b.chain);
    if (chainForward === undefined) {
      chainForward = new Map();
      forward.set(b.chain, chainForward);
    }
    let chainReverse = reverse.get(b.chain);
    if (chainReverse === undefined) {
      chainReverse = new Map();
      reverse.set(b.chain, chainReverse);
    }
    const identityKey = b.identity_id as unknown as string;
    const addressKey = b.address as unknown as string;
    const existingByAddress = chainReverse.get(addressKey);
    if (existingByAddress !== undefined && existingByAddress !== b.identity_id) {
      throw new Error(
        `IdentityResolver bind conflict on chain="${b.chain}" address="${addressKey}": already mapped to identity "${existingByAddress as unknown as string}"`,
      );
    }
    chainForward.set(identityKey, b.address);
    chainReverse.set(addressKey, b.identity_id);
  };

  // seed initial bindings
  for (const b of config.bindings ?? []) bindOne(b);

  const port: IdentityResolverPort = {
    resolveToChainAddress: (identity: IdentityId, chain: string) =>
      Effect.gen(function* () {
        const failureReason = consumeSimulatedFailure("resolveToChainAddress");
        if (failureReason !== null) {
          return yield* Effect.fail(
            IdentityResolverUnavailable.make({ resolver_id: resolverId, reason: failureReason }),
          );
        }
        if (!chainSupported(chain)) {
          return yield* Effect.fail(IdentityChainNotSupported.make({ chain }));
        }
        const chainForward = forward.get(chain);
        const addr = chainForward?.get(identity as unknown as string);
        if (addr === undefined) {
          return yield* Effect.fail(
            IdentityUnresolvableIdentity.make({ identity_id: identity }),
          );
        }
        return addr;
      }) as Effect.Effect<ChainAddress, IdentityResolverError>,

    resolveFromChainAddress: (address: ChainAddress, chain: string) =>
      Effect.gen(function* () {
        const failureReason = consumeSimulatedFailure("resolveFromChainAddress");
        if (failureReason !== null) {
          return yield* Effect.fail(
            IdentityResolverUnavailable.make({ resolver_id: resolverId, reason: failureReason }),
          );
        }
        if (!chainSupported(chain)) {
          return yield* Effect.fail(IdentityChainNotSupported.make({ chain }));
        }
        const chainReverse = reverse.get(chain);
        const identity = chainReverse?.get(address as unknown as string);
        if (identity === undefined) {
          return yield* Effect.fail(
            // Reverse miss is also expressed as UnresolvableIdentity — there
            // is no separate "AddressNotFound" variant in the protocol's
            // sealed error union; FR-12 deliberately keeps the surface small.
            IdentityUnresolvableIdentity.make({
              identity_id: address as unknown as IdentityId,
            }),
          );
        }
        return identity;
      }) as Effect.Effect<IdentityId, IdentityResolverError>,
  };

  return {
    port,
    bind: bindOne,
    clear: () => {
      forward.clear();
      reverse.clear();
    },
  };
};
