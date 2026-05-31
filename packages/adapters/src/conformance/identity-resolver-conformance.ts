/**
 * IdentityResolverPort conformance suite as a factory function
 * (write-path defect #21.3 · reusable black-box).
 *
 * BEFORE this suite, `makePostgresIdentityResolver` ran ZERO test lines. This
 * is the shared black-box contract every IdentityResolverPort MUST pass:
 * in-memory (Map-backed reference) AND postgres (UNIQUE(chain,address)-backed).
 *
 * The load-bearing invariant is CL-Identity-4 REVERSE-UNIQUENESS: an address
 * binds to AT MOST ONE identity per chain, and forward/reverse resolution is
 * consistent. A conflicting bind (same chain+address → a DIFFERENT identity)
 * MUST be rejected — in postgres that surfaces from a 23505 on
 * UNIQUE(chain,address) mapped to a sealed IdentityResolverError; in-memory the
 * Map-backed stub raises the same conflict synchronously. The factory adapts
 * each adapter's bind surface so the suite stays adapter-agnostic.
 *
 * Factory contract:
 *   - returns a `{ port, bind, bindConflicts?, clear? }` bundle
 *   - `bind(b)` seeds a binding; MUST be awaited (Promise) so both the sync
 *     in-memory and the Effect-based postgres bind compose.
 *   - `bindConflicts(b)` attempts a CONFLICTING bind (an address already mapped
 *     to a different identity on the same chain) and resolves to:
 *       { conflict: true } if the adapter rejected it (sealed error / throw), or
 *       { conflict: false } if it (incorrectly) accepted it.
 *     This keeps the assertion black-box across the two bind error surfaces.
 *   - bundle MUST be freshly-allocated per call (independent store).
 */
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ChainAddress,
  IdentityId,
  type IdentityResolverPort,
} from "@0xhoneyjar/quests-protocol";

const decode = Schema.decodeUnknownSync;

const fixtures = {
  identityA: decode(IdentityId)("id_a"),
  identityB: decode(IdentityId)("id_b"),
  addrA: decode(ChainAddress)("0xaaaa000000000000000000000000000000000000"),
  addrB: decode(ChainAddress)("0xbbbb000000000000000000000000000000000000"),
  chain: "evm:1",
  chainOther: "evm:8453",
};

export interface IdentityBindingForConformance {
  readonly identity_id: typeof fixtures.identityA;
  readonly chain: string;
  readonly address: typeof fixtures.addrA;
}

export interface IdentityResolverConformanceBundle {
  readonly port: IdentityResolverPort;
  /** Seed a (identity, chain) → address binding. Awaited so sync + Effect bind compose. */
  readonly bind: (b: IdentityBindingForConformance) => Promise<void>;
  /**
   * Attempt a CONFLICTING bind (address already mapped to a different identity
   * on the same chain). Resolves { conflict: true } iff the adapter REJECTED it.
   */
  readonly bindConflicts: (
    b: IdentityBindingForConformance,
  ) => Promise<{ readonly conflict: boolean }>;
  readonly clear?: () => void;
}

export interface IdentityResolverConformanceFactoryConfig {
  readonly supportedChains?: ReadonlySet<string>;
  readonly simulatedFailures?: ReadonlyArray<{
    readonly on: "resolveToChainAddress" | "resolveFromChainAddress" | "any";
    readonly reason: string;
  }>;
}

export type IdentityResolverConformanceFactory = (
  config?: IdentityResolverConformanceFactoryConfig,
) => IdentityResolverConformanceBundle;

/**
 * runIdentityResolverConformanceSuite — black-box conformance gate.
 *
 * Adapters MUST pass:
 *   - forward resolve hits a bound address; reverse resolve round-trips back
 *     (CL-Identity-4 consistency)
 *   - a single identity binds to MULTIPLE chains (CL-Identity-3)
 *   - REVERSE-UNIQUENESS: a conflicting bind (chain+address → different
 *     identity) is REJECTED (the 23505→sealed-error path in postgres)
 *   - CL-Port-2: every IdentityResolverError variant reachable
 */
export const runIdentityResolverConformanceSuite = (
  factory: IdentityResolverConformanceFactory,
  adapterName: string,
): void => {
  describe(`IdentityResolverPort conformance — ${adapterName}`, () => {
    it("forward + reverse round-trip is consistent (CL-Identity-4)", async () => {
      const bundle = factory();
      await bundle.bind({
        identity_id: fixtures.identityA,
        chain: fixtures.chain,
        address: fixtures.addrA,
      });
      const fwd = await Effect.runPromise(
        bundle.port.resolveToChainAddress(fixtures.identityA, fixtures.chain),
      );
      expect(fwd).toBe(fixtures.addrA);
      const rev = await Effect.runPromise(
        bundle.port.resolveFromChainAddress(fixtures.addrA, fixtures.chain),
      );
      expect(rev).toBe(fixtures.identityA);
    });

    it("one identity binds to MULTIPLE chains (CL-Identity-3)", async () => {
      const bundle = factory();
      await bundle.bind({
        identity_id: fixtures.identityA,
        chain: fixtures.chain,
        address: fixtures.addrA,
      });
      await bundle.bind({
        identity_id: fixtures.identityA,
        chain: fixtures.chainOther,
        address: fixtures.addrB,
      });
      const onA = await Effect.runPromise(
        bundle.port.resolveToChainAddress(fixtures.identityA, fixtures.chain),
      );
      const onB = await Effect.runPromise(
        bundle.port.resolveToChainAddress(fixtures.identityA, fixtures.chainOther),
      );
      expect(onA).toBe(fixtures.addrA);
      expect(onB).toBe(fixtures.addrB);
    });

    describe("CL-Identity-4 — reverse uniqueness", () => {
      it("a conflicting bind (chain+address → a DIFFERENT identity) is REJECTED", async () => {
        const bundle = factory();
        await bundle.bind({
          identity_id: fixtures.identityA,
          chain: fixtures.chain,
          address: fixtures.addrA,
        });
        // identityB tries to claim the SAME (chain, address) → must be refused
        // (postgres: 23505 on UNIQUE(chain,address) → sealed error; in-memory:
        // synchronous conflict). Either way: conflict === true.
        const outcome = await bundle.bindConflicts({
          identity_id: fixtures.identityB,
          chain: fixtures.chain,
          address: fixtures.addrA,
        });
        expect(outcome.conflict).toBe(true);

        // And the original binding is intact: reverse still resolves to A.
        const rev = await Effect.runPromise(
          bundle.port.resolveFromChainAddress(fixtures.addrA, fixtures.chain),
        );
        expect(rev).toBe(fixtures.identityA);
      });
    });

    describe("CL-Port-2 — every IdentityResolverError variant reachable", () => {
      it("touches all 3 variants from one configured port instance", async () => {
        const reached = new Set<string>();
        const bundle = factory({
          supportedChains: new Set([fixtures.chain]),
          simulatedFailures: [{ on: "any", reason: "induced" }],
        });
        // 1. ResolverUnavailable (consumes the simulated failure)
        const f1 = await Effect.runPromise(
          Effect.flip(
            bundle.port.resolveToChainAddress(fixtures.identityA, fixtures.chain),
          ),
        );
        reached.add(f1._tag);
        // 2. ChainNotSupported
        const f2 = await Effect.runPromise(
          Effect.flip(
            bundle.port.resolveToChainAddress(fixtures.identityA, "evm:999999"),
          ),
        );
        reached.add(f2._tag);
        // 3. UnresolvableIdentity (no binding for identityA on the supported chain)
        const f3 = await Effect.runPromise(
          Effect.flip(
            bundle.port.resolveToChainAddress(fixtures.identityA, fixtures.chain),
          ),
        );
        reached.add(f3._tag);

        expect(reached).toEqual(
          new Set([
            "ResolverUnavailable",
            "ChainNotSupported",
            "UnresolvableIdentity",
          ]),
        );
      });
    });
  });
};
