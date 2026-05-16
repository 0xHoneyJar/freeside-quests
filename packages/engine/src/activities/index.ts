/**
 * Activities substrate engine surface (sprint-2 · SDD §3.5).
 *
 * Exposed:
 *   - Port Tag identities (T2.6 · cross-pack via A2)
 *   - Default Effect Layer composing in-memory adapters
 *   - Activity lifecycle state machine (T2.7)
 *   - Reward retry orchestrator (T2.8)
 */

// Port Tags + identities
export {
  ACTIVITY_PORT_TAG_IDENTITIES,
  COMPLETION_EVENT_PORT_TAG_IDENTITY,
  CompletionEventPortTag,
  IDENTITY_RESOLVER_PORT_TAG_IDENTITY,
  IdentityResolverPortTag,
  PROGRESS_PORT_TAG_IDENTITY,
  ProgressPortTag,
  REWARD_PORT_TAG_IDENTITY,
  RewardPortTag,
} from "./ports.js";

// Composition
export {
  buildDefaultActivitiesLayer,
  type ActivitiesLayerHandles,
  type DefaultActivitiesLayerConfig,
} from "./compose.js";

// Lifecycle
export {
  advance,
  InvalidTransition,
  isTerminal,
  legalTransitionsFrom,
  TerminalState,
  type LifecycleError,
} from "./lifecycle.js";

// Retry
export {
  retryGrant,
  RetriesExhausted,
  TerminalGrantFailure,
  type RetryError,
  type RetryPolicy,
} from "./retry.js";
