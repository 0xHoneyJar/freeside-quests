/**
 * Wires the canonical RewardPort conformance suite to the in-memory adapter
 * factory (sprint-2 review C3 · Fix-S5). Production adapters (postgres ·
 * convex) re-run this same suite by importing
 * `runRewardPortConformanceSuite` and supplying their own factory.
 */
import { runRewardPortConformanceSuite } from "../../conformance/reward-port-conformance.js";
import { makeInMemoryRewardPort } from "../reward.js";

runRewardPortConformanceSuite(
  (config = {}) =>
    ({
      port: makeInMemoryRewardPort({
        unresolvableIdentities: config.unresolvableIdentities,
        failingGrants: config.failingGrants,
        simulatedFailures: config.simulatedFailures,
      }).port,
    }),
  "in-memory adapter",
);
