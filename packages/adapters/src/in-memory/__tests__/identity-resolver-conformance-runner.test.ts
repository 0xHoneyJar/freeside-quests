/**
 * In-memory IdentityResolverPort conformance (defect #21.3 · reference adapter).
 *
 * Wires the shared `runIdentityResolverConformanceSuite` to the Map-backed
 * in-memory resolver. The in-memory `bind` throws synchronously on a reverse-
 * uniqueness conflict; the factory adapts that into the bundle's
 * `bindConflicts` shape so the shared suite stays adapter-agnostic.
 */
import {
  runIdentityResolverConformanceSuite,
  type IdentityBindingForConformance,
} from "../../conformance/identity-resolver-conformance.js";
import { makeInMemoryIdentityResolver } from "../identity-resolver.js";

runIdentityResolverConformanceSuite((config = {}) => {
  const handle = makeInMemoryIdentityResolver({
    supportedChains: config.supportedChains,
    simulatedFailures: config.simulatedFailures,
  });
  return {
    port: handle.port,
    bind: async (b: IdentityBindingForConformance) => {
      handle.bind({
        identity_id: b.identity_id,
        chain: b.chain,
        address: b.address,
      });
    },
    bindConflicts: async (b: IdentityBindingForConformance) => {
      try {
        handle.bind({
          identity_id: b.identity_id,
          chain: b.chain,
          address: b.address,
        });
        return { conflict: false };
      } catch {
        return { conflict: true };
      }
    },
    clear: handle.clear,
  };
}, "in-memory adapter");
