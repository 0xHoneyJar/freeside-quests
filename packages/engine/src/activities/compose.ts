/**
 * activities.compose — default Effect Layer wiring for the activities
 * substrate (T2.6 · SDD §3.5 · per A2 cross-pack identity).
 *
 * Provides a default Layer that satisfies all 4 activity port Tags with
 * in-memory adapters. World composition roots override individual ports
 * by merging a different Layer in (Layer.provide / Layer.merge).
 *
 * Default Layer is intentionally TEST-FIXTURE-grade. Production worlds
 * MUST replace the IdentityResolver Layer (architectural lock A5).
 */
import { Layer } from "effect";

import {
  makeInMemoryEventStore,
  makeInMemoryIdentityResolver,
  makeInMemoryProgressPort,
  makeInMemoryRewardPort,
  type IdentityBinding,
  type InMemoryEventStoreConfig,
  type InMemoryIdentityResolverConfig,
  type InMemoryProgressPortConfig,
  type InMemoryRewardPortConfig,
} from "@0xhoneyjar/freeside-activities-adapters";

import {
  CompletionEventPortTag,
  IdentityResolverPortTag,
  ProgressPortTag,
  RewardPortTag,
} from "./ports.js";

/**
 * Per-port configuration knobs surfaced through the default Layer. World
 * composition roots pass these to seed catalogs / supported chains / etc.
 */
export interface DefaultActivitiesLayerConfig {
  readonly progress?: InMemoryProgressPortConfig;
  readonly eventStore?: InMemoryEventStoreConfig;
  readonly reward?: InMemoryRewardPortConfig;
  readonly identityResolver?: InMemoryIdentityResolverConfig;
  /**
   * Convenience: seed identity bindings without populating
   * `identityResolver.bindings` directly. Merged with whatever is in
   * `identityResolver.bindings` (this list appended last).
   */
  readonly identityBindings?: ReadonlyArray<IdentityBinding>;
}

/**
 * buildDefaultActivitiesLayer — wires all 4 activity port Tags to fresh
 * in-memory adapters. Each call produces an independent Layer (so two
 * test scenarios get isolated stores).
 *
 * Pattern (per loa-finn#157 substrate-runtime swap-shape): a world that
 * wants to swap (e.g.) the IdentityResolver simply merges its own
 * `Layer.succeed(IdentityResolverPortTag, ...)` AFTER this Layer.
 */
export const buildDefaultActivitiesLayer = (
  config: DefaultActivitiesLayerConfig = {},
) => {
  const progress = makeInMemoryProgressPort(config.progress);
  const eventStore = makeInMemoryEventStore(config.eventStore);
  const reward = makeInMemoryRewardPort(config.reward);
  const identity = makeInMemoryIdentityResolver({
    ...config.identityResolver,
    bindings: [
      ...(config.identityResolver?.bindings ?? []),
      ...(config.identityBindings ?? []),
    ],
  });

  const layer = Layer.mergeAll(
    Layer.succeed(ProgressPortTag, progress.port),
    Layer.succeed(CompletionEventPortTag, eventStore.port),
    Layer.succeed(RewardPortTag, reward.port),
    Layer.succeed(IdentityResolverPortTag, identity.port),
  );

  return {
    layer,
    handles: {
      progress,
      eventStore,
      reward,
      identity,
    },
  } as const;
};

export type ActivitiesLayerHandles = ReturnType<
  typeof buildDefaultActivitiesLayer
>["handles"];
