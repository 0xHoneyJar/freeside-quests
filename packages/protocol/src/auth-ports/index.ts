/**
 * Auth port surfaces (S1.T1.16b + sprint-2 review C1/C2).
 *
 * Decoupled from `packages/protocol/src/auth/` (which holds the canonical
 * Schema.Struct shapes) — these are PORT interfaces (Effect.Effect-returning
 * functions) defining how worlds plug auth-state implementations into the
 * substrate.
 */

export {
  KeyExpired,
  KeyProviderUnavailable,
  KeyRevoked,
  KeyRotationState,
  KeyState,
  KidNotFound,
  type KeyProviderError,
  type KeyProviderPort,
} from "./KeyProviderPort.js";

export {
  ReplayStoreUnavailable,
  type AuthReplayStore,
  type RecordOutcome,
  type ReplayStoreError,
} from "./AuthReplayStore.js";
