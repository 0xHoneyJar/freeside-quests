/**
 * Quest engine error types — Effect-native tagged errors.
 *
 * Substrate-detected violations (defense-in-depth at boundary). Each error
 * is a `Data.TaggedError` so consumers can pattern-match in Effect chains.
 *
 * Cycle-Q · 2026-05-04 · sprint-2 ENGINE+PERSIST · SDD §3.6.
 */

import { Data } from "effect";

// ---------------------------------------------------------------------------
// Tagged errors
// ---------------------------------------------------------------------------

/** Raised when a quest_id is not in the persistence layer. */
export class QuestNotFoundError extends Data.TaggedError("QuestNotFoundError")<{
  quest_id: string;
}> {}

/**
 * Raised by `transitions.{accept,submit,judge,finalize}` when the
 * current state's phase does not match the from-phase contract.
 */
export class InvalidPhaseTransitionError extends Data.TaggedError(
  "InvalidPhaseTransitionError",
)<{
  quest_id: string;
  from_phase: string;
  to_phase: string;
  reason: string;
}> {}

/**
 * Raised by adapters at load() time when the persisted state_json fails
 * Schema.decodeUnknown(QuestState). Defense-in-depth against deploy-time
 * schema drift.
 */
export class StateDecodeError extends Data.TaggedError("StateDecodeError")<{
  quest_id: string;
  cause: unknown;
}> {}

/**
 * Raised by adapters when the underlying persistence backend fails
 * (DB connection lost, network timeout, etc.). The `operation` field
 * names which port verb failed.
 */
export class PersistenceError extends Data.TaggedError("PersistenceError")<{
  operation: "load" | "save" | "list" | "delete";
  cause: unknown;
}> {}

/**
 * Raised by stub adapters whose real implementation is deferred to a
 * future cycle. Currently used by the `substrate-runtime` adapter, which
 * defers to `loa-finn#157` (cycle-2 close-out).
 *
 * Per SDD §10.1: the `// @future #157` marker in adapter source is the
 * grep-traceable upgrade path.
 */
export class NotImplementedError extends Data.TaggedError("NotImplementedError")<{
  surface: string;
  defer_to: string; // e.g. "loa-finn#157"
}> {}

// ---------------------------------------------------------------------------
// Union type for engine error surfaces
// ---------------------------------------------------------------------------

export type QuestEngineError =
  | QuestNotFoundError
  | InvalidPhaseTransitionError
  | StateDecodeError
  | PersistenceError
  | NotImplementedError;
