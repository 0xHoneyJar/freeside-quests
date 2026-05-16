/**
 * IdentityResolverPort conformance — in-memory adapter (T2.5 · FR-12).
 */
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ChainAddress, IdentityId } from "@0xhoneyjar/quests-protocol";

import {
  type IdentityBinding,
  makeInMemoryIdentityResolver,
} from "../identity-resolver.js";

const decode = Schema.decodeUnknownSync;
const identityA = decode(IdentityId)("id_a");
const identityB = decode(IdentityId)("id_b");
const addrEth = decode(ChainAddress)("0xAaAa000000000000000000000000000000000001");
const addrSol = decode(ChainAddress)("So1ana11111111111111111111111111111111111111");

const bindingA_eth: IdentityBinding = {
  identity_id: identityA,
  chain: "ethereum",
  address: addrEth,
};

const bindingA_sol: IdentityBinding = {
  identity_id: identityA,
  chain: "solana",
  address: addrSol,
};

describe("makeInMemoryIdentityResolver", () => {
  describe("forward + reverse roundtrip (CL-Identity-4)", () => {
    it("returns the bound address forward", async () => {
      const { port } = makeInMemoryIdentityResolver({
        bindings: [bindingA_eth],
      });
      const result = await Effect.runPromise(
        port.resolveToChainAddress(identityA, "ethereum"),
      );
      expect(result).toBe(addrEth);
    });

    it("returns the bound identity reverse", async () => {
      const { port } = makeInMemoryIdentityResolver({
        bindings: [bindingA_eth],
      });
      const result = await Effect.runPromise(
        port.resolveFromChainAddress(addrEth, "ethereum"),
      );
      expect(result).toBe(identityA);
    });

    it("forward then reverse round-trips to the same identity", async () => {
      const { port } = makeInMemoryIdentityResolver({ bindings: [bindingA_eth] });
      const forward = await Effect.runPromise(
        port.resolveToChainAddress(identityA, "ethereum"),
      );
      const reverse = await Effect.runPromise(
        port.resolveFromChainAddress(forward, "ethereum"),
      );
      expect(reverse).toBe(identityA);
    });
  });

  describe("CL-Identity-3 — single identity → multiple chains", () => {
    it("resolves the same identity on two different chains", async () => {
      const { port } = makeInMemoryIdentityResolver({
        bindings: [bindingA_eth, bindingA_sol],
      });
      const eth = await Effect.runPromise(port.resolveToChainAddress(identityA, "ethereum"));
      const sol = await Effect.runPromise(port.resolveToChainAddress(identityA, "solana"));
      expect(eth).toBe(addrEth);
      expect(sol).toBe(addrSol);
    });
  });

  describe("error variants — CL-Port-2 reachability", () => {
    it("UnresolvableIdentity when identity has no binding on the chain", async () => {
      const { port } = makeInMemoryIdentityResolver();
      const fail = await Effect.runPromise(
        Effect.flip(port.resolveToChainAddress(identityB, "ethereum")),
      );
      expect(fail._tag).toBe("UnresolvableIdentity");
    });

    it("ChainNotSupported when caller asks for unsupported chain", async () => {
      const { port } = makeInMemoryIdentityResolver({
        supportedChains: new Set(["ethereum"]),
      });
      const fail = await Effect.runPromise(
        Effect.flip(port.resolveToChainAddress(identityA, "starknet")),
      );
      expect(fail._tag).toBe("ChainNotSupported");
      if (fail._tag === "ChainNotSupported") {
        expect(fail.chain).toBe("starknet");
      }
    });

    it("ResolverUnavailable via simulated-failure hook", async () => {
      const { port } = makeInMemoryIdentityResolver({
        simulatedFailures: [{ on: "resolveToChainAddress", reason: "rpc-timeout" }],
      });
      const fail = await Effect.runPromise(
        Effect.flip(port.resolveToChainAddress(identityA, "ethereum")),
      );
      expect(fail._tag).toBe("ResolverUnavailable");
    });

    it("touches all 3 IdentityResolverError variants from one port instance", async () => {
      const reached = new Set<string>();
      const { port } = makeInMemoryIdentityResolver({
        bindings: [bindingA_eth],
        supportedChains: new Set(["ethereum"]),
        simulatedFailures: [{ on: "any", reason: "induced" }],
      });
      // 1. ResolverUnavailable (consumes simulated failure)
      const a = await Effect.runPromise(
        Effect.flip(port.resolveToChainAddress(identityA, "ethereum")),
      );
      reached.add(a._tag);
      // 2. ChainNotSupported
      const b = await Effect.runPromise(
        Effect.flip(port.resolveToChainAddress(identityA, "polygon")),
      );
      reached.add(b._tag);
      // 3. UnresolvableIdentity
      const c = await Effect.runPromise(
        Effect.flip(port.resolveToChainAddress(identityB, "ethereum")),
      );
      reached.add(c._tag);
      expect(reached).toEqual(
        new Set(["ResolverUnavailable", "ChainNotSupported", "UnresolvableIdentity"]),
      );
    });
  });

  describe("bind conflict detection", () => {
    it("throws when two identities are bound to the same address on the same chain", () => {
      expect(() =>
        makeInMemoryIdentityResolver({
          bindings: [
            bindingA_eth,
            { identity_id: identityB, chain: "ethereum", address: addrEth },
          ],
        }),
      ).toThrow(/bind conflict/);
    });

    it("allows the same address on different chains", () => {
      // Address shape is opaque per A5 — same string can be a different
      // chain's address; constructor accepts.
      expect(() =>
        makeInMemoryIdentityResolver({
          bindings: [
            bindingA_eth,
            { identity_id: identityB, chain: "polygon", address: addrEth },
          ],
        }),
      ).not.toThrow();
    });
  });
});
