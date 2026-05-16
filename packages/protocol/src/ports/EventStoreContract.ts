import type { Effect } from "effect";
import { Schema } from "effect";

import { EventId } from "../branded/EventId.js";
import { PartitionKey } from "../branded/PartitionKey.js";
import type { EventEnvelope } from "../events/EventEnvelope.js";
import type { EventError } from "../events/EventError.js";

/**
 * AppendOptions — caller-supplied hints for EventStoreContract.append
 * (FR-11 · per SDD §4.2).
 *
 * `expected_tip_hash` enables Compare-And-Set: the caller asserts what they
 * believe the partition's latest event_id was; the store rejects with
 * {@link EventError.CASFailed} if it has advanced past that point.
 */
export const AppendOptions = Schema.Struct({
  partition_key: PartitionKey,
  expected_tip_hash: Schema.NullOr(EventId),
});

export type AppendOptions = Schema.Schema.Type<typeof AppendOptions>;

/**
 * TipDescriptor — what {@link EventStoreContract.getTip} returns. Null tip
 * means "partition has no events yet" (first appender sets the initial tip).
 */
export const TipDescriptor = Schema.Struct({
  partition_key: PartitionKey,
  tip_event_id: Schema.NullOr(EventId),
  monotonic_sequence: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export type TipDescriptor = Schema.Schema.Type<typeof TipDescriptor>;

/**
 * EventStoreContract — adapter conformance gate (FR-11 · CL-EventStore-1..7 ·
 * per SDD §4.2).
 *
 * Every adapter implementing event ingress (in-memory · postgres · convex)
 * MUST conform to this contract. Conformance is enforced by the canonical
 * event-store-conformance.test.ts suite (T2.2 ships the in-memory adapter
 * + its conformance runner).
 *
 * Invariants enforced by ALL conforming adapters:
 *   - **CL-EventStore-1** APPEND-ONLY: no event update / delete; CAS only
 *   - **CL-EventStore-2** monotonic-sequence per partition (never decreases)
 *   - **CL-EventStore-3** CAS via `expected_tip_hash` — two concurrent writers
 *     with the same expected_tip_hash → exactly one wins
 *   - **CL-EventStore-4** duplicate-reject by event_id (DuplicateEvent)
 *   - **CL-EventStore-5** partition_key.scope determines monotonic-sequence
 *     grouping (IMP-016 RESOLVED)
 *   - **CL-EventStore-6** replay-determinism: re-reading the same partition
 *     returns the same events in the same order (monotonic-sequence ASC)
 *   - **CL-EventStore-7** nonce-mediated collision: two events with identical
 *     other-fields but distinct nonce → both accepted (CL-Event-5)
 *
 * Errors are surfaced through the protocol's {@link EventError} sealed union
 * so callers don't need adapter-specific failure handling.
 */
export interface EventStoreContract {
  /**
   * Appends an event to its partition. The event's event_id is the caller's
   * responsibility (must be the canonical hash per §5.6 · computeEventId).
   *
   * - Rejects with CASFailed if `expected_tip_hash` ≠ current tip
   * - Rejects with DuplicateEvent if event_id already exists
   * - Rejects with PartitionScopeMismatch if partition_key.scope doesn't match
   */
  readonly append: (
    event: EventEnvelope,
    options: AppendOptions,
  ) => Effect.Effect<TipDescriptor, EventError>;

  /**
   * Reads the current tip of a partition (the most recently appended event_id
   * + the monotonic_sequence counter). Returns null tip if empty.
   */
  readonly getTip: (partition: PartitionKey) => Effect.Effect<TipDescriptor, EventError>;

  /**
   * Reads ALL events of a partition in canonical monotonic-sequence order
   * (replay-determinism per CL-EventStore-6). Pagination via `after_sequence`
   * for large partitions.
   */
  readonly read: (
    partition: PartitionKey,
    after_sequence?: number,
  ) => Effect.Effect<ReadonlyArray<EventEnvelope>, EventError>;
}
