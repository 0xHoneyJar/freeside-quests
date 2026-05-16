/**
 * Activity port Tag identities (T2.6 · SDD §3.5 · per A2 cross-pack identity).
 *
 * Effect's Context.Tag resolves services by string identity. World adapters
 * (postgres · convex · etc) live in different packages but bind to the SAME
 * Tag by referencing these exact strings. Per [[contracts-as-bridges]]: the
 * Tag identity is the bridge that survives adapter rotation.
 *
 * If you change a Tag identity, you break every world that pins against it.
 * These are LOAD-BEARING constants. Treat them as architectural locks.
 */
import { Context } from "effect";

import type {
  CompletionEventPort as CompletionEventPortShape,
  IdentityResolverPort as IdentityResolverPortShape,
  ProgressPort as ProgressPortShape,
  RewardPort as RewardPortShape,
} from "@0xhoneyjar/quests-protocol";

export const PROGRESS_PORT_TAG_IDENTITY =
  "@0xhoneyjar/freeside-activities/ProgressPort" as const;

export const COMPLETION_EVENT_PORT_TAG_IDENTITY =
  "@0xhoneyjar/freeside-activities/CompletionEventPort" as const;

export const REWARD_PORT_TAG_IDENTITY =
  "@0xhoneyjar/freeside-activities/RewardPort" as const;

export const IDENTITY_RESOLVER_PORT_TAG_IDENTITY =
  "@0xhoneyjar/freeside-activities/IdentityResolverPort" as const;

export const ProgressPortTag = Context.GenericTag<ProgressPortShape>(
  PROGRESS_PORT_TAG_IDENTITY,
);

export const CompletionEventPortTag = Context.GenericTag<CompletionEventPortShape>(
  COMPLETION_EVENT_PORT_TAG_IDENTITY,
);

export const RewardPortTag = Context.GenericTag<RewardPortShape>(
  REWARD_PORT_TAG_IDENTITY,
);

export const IdentityResolverPortTag = Context.GenericTag<IdentityResolverPortShape>(
  IDENTITY_RESOLVER_PORT_TAG_IDENTITY,
);

/**
 * The 4 cross-pack identities the substrate publishes. World adapters that
 * implement these MUST use these exact strings when declaring their Tags.
 */
export const ACTIVITY_PORT_TAG_IDENTITIES = {
  progress: PROGRESS_PORT_TAG_IDENTITY,
  completionEvent: COMPLETION_EVENT_PORT_TAG_IDENTITY,
  reward: REWARD_PORT_TAG_IDENTITY,
  identityResolver: IDENTITY_RESOLVER_PORT_TAG_IDENTITY,
} as const;
