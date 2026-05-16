/**
 * Typed ports + EventStoreContract for the freeside-activities protocol
 * (T1.13 + T1.14 + T1.15 · per PRD §FR-8 + §FR-11 + SDD §3.2 + §4.2).
 *
 * 4 ports — every operation returns Effect<R, E> · NO bare throws (CL-Port-1).
 * 1 contract — EventStoreContract is the adapter conformance gate (FR-11).
 *
 * Adapters in `packages/adapters/in-memory/` implement these interfaces
 * and pass the canonical conformance suites in `packages/adapters/in-memory/__tests__/`.
 */

export type { CompletionEventPort } from "./CompletionEventPort.js";
export { EventFilter } from "./CompletionEventPort.js";
export type { EventStoreContract } from "./EventStoreContract.js";
export { AppendOptions, TipDescriptor } from "./EventStoreContract.js";
export type { IdentityResolverPort } from "./IdentityResolverPort.js";
export {
  ChainAddress,
  IdentityChainNotSupported,
  IdentityResolverError,
  IdentityResolverUnavailable,
  IdentityUnresolvableIdentity,
} from "./IdentityResolverPort.js";
export type { ProgressPort } from "./ProgressPort.js";
export {
  ProgressActivityNotFound,
  ProgressAdapterUnavailable,
  ProgressConcurrentUpdate,
  ProgressError,
  ProgressIdentityNotFound,
} from "./ProgressPort.js";

export {
  ProgressLifecycleState,
  ProgressRecord,
} from "./ProgressRecord.js";
export type { RewardPort } from "./RewardPort.js";
export {
  RewardAdapterUnavailable,
  RewardAlreadyGranted,
  RewardError,
  RewardGrantFailed,
  RewardIdentityUnresolvable,
} from "./RewardPort.js";
