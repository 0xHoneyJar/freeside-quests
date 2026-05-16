/**
 * In-memory adapter family for @0xhoneyjar/quests-protocol ports.
 *
 * Adapter shipping rules (per SDD §3.3 + kickoff):
 *   - in-memory adapters ship with this module · they are TEST/DEV fixtures
 *   - production adapters (postgres · convex · etc) are world-built
 *   - every adapter passes the canonical conformance test suite (T2.2)
 */

export { makeInMemoryProgressPort } from "./progress.js";
export type {
  InMemoryProgressPortConfig,
  InMemoryProgressPortHandle,
} from "./progress.js";

export { makeInMemoryEventStore } from "./completion-event.js";
export type {
  InMemoryEventStoreConfig,
  InMemoryEventStoreHandle,
} from "./completion-event.js";

export { makeInMemoryRewardPort } from "./reward.js";
export type {
  InMemoryRewardPortConfig,
  InMemoryRewardPortHandle,
} from "./reward.js";

export { makeInMemoryIdentityResolver } from "./identity-resolver.js";
export type {
  IdentityBinding,
  InMemoryIdentityResolverConfig,
  InMemoryIdentityResolverHandle,
} from "./identity-resolver.js";
