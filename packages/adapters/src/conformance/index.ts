/**
 * Adapter conformance suites — reusable black-box test contracts.
 *
 * Any adapter that implements an activities-substrate port imports the
 * corresponding `run*ConformanceSuite` and invokes it with its factory.
 * Same scenarios run against every adapter — postgres / convex / in-memory
 * all pass the same gate.
 */

export {
  runEventStoreConformanceSuite,
  type EventStoreConformanceBundle,
  type EventStoreConformanceFactory,
  type EventStoreConformanceFactoryConfig,
} from "./event-store-conformance.js";

export {
  runRewardPortConformanceSuite,
  type RewardPortConformanceBundle,
  type RewardPortConformanceFactory,
  type RewardPortConformanceFactoryConfig,
} from "./reward-port-conformance.js";

export {
  runProgressPortConformanceSuite,
  type ProgressPortConformanceBundle,
  type ProgressPortConformanceFactory,
  type ProgressPortConformanceFactoryConfig,
} from "./progress-port-conformance.js";

export {
  runIdentityResolverConformanceSuite,
  type IdentityBindingForConformance,
  type IdentityResolverConformanceBundle,
  type IdentityResolverConformanceFactory,
  type IdentityResolverConformanceFactoryConfig,
} from "./identity-resolver-conformance.js";
