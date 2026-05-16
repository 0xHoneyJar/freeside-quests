import { Effect, Schema } from "effect";

import {
  type ActivityCompleted,
  type AppendOptions,
  CASFailed,
  type CompletionEventPort,
  computeEventId,
  DuplicateEvent,
  type EventEnvelope,
  type EventError,
  type EventFilter,
  type EventId,
  type EventStoreContract,
  isMutatingEvent,
  NonceRequired,
  type PartitionKey,
  type TipDescriptor,
} from "@0xhoneyjar/quests-protocol";

/**
 * Serializable shape of a PartitionKey used as a Map key. Two distinct
 * PartitionKey values with the same (scope, value) MUST produce the same
 * serialized form (the Schema brand ensures structural equivalence).
 */
const partitionKeyToString = (pk: PartitionKey): string =>
  `${pk.scope}::${pk.value}`;

interface PartitionState {
  readonly partition_key: PartitionKey;
  /** ordered append log (monotonic-sequence ASC per CL-EventStore-2) */
  readonly events: EventEnvelope[];
  /** event_id Set for O(1) duplicate-reject (CL-EventStore-4) */
  readonly eventIds: Set<EventId>;
  /** current tip event_id (null = empty partition) */
  tip: EventId | null;
}

/**
 * Configuration for {@link makeInMemoryEventStore}.
 *
 * - `expectedScope` — when set, append + getTip + read REJECT any
 *   PartitionKey whose `scope` does NOT match with PartitionScopeMismatch.
 *   The CompletionEventPort's emit / query helpers default to the
 *   "activity" scope unless overridden via {@link InMemoryEventStoreConfig.partitionScopeForCompletion}.
 *   Use this when binding the store to a single scope (the common case).
 * - `partitionScopeForCompletion` — scope to use when CompletionEventPort.emit
 *   computes the partition key from an event. Defaults to "activity".
 *   The value field is filled from event.activity_id.
 * - `verifyEventId` — when true, append re-runs computeEventId and rejects
 *   with SchemaValidation if the caller-supplied event_id doesn't match.
 *   Defaults to true (catches A6 violations early in tests).
 */
export interface InMemoryEventStoreConfig {
  readonly expectedScope?: PartitionKey["scope"];
  readonly partitionScopeForCompletion?: PartitionKey["scope"];
  readonly verifyEventId?: boolean;
}

export interface InMemoryEventStoreHandle {
  readonly contract: EventStoreContract;
  readonly port: CompletionEventPort;
  readonly snapshot: () => ReadonlyArray<{
    readonly partition_key: PartitionKey;
    readonly events: ReadonlyArray<EventEnvelope>;
  }>;
  readonly clear: () => void;
}

/**
 * makeInMemoryEventStore — constructs an in-memory implementation of both
 * {@link EventStoreContract} and {@link CompletionEventPort} (T2.2 · SDD §3.3 +
 * §4.2 + Fix-A1).
 *
 * Invariants enforced (CL-EventStore-1..7 + Fix-A1):
 *   - **CL-EventStore-1** APPEND-ONLY: no update/delete API, ever.
 *   - **CL-EventStore-2** monotonic sequence per partition_key.
 *   - **CL-EventStore-3** CAS via `expected_tip_hash`: two concurrent writers
 *     starting from the same tip → exactly one wins; the other gets CASFailed.
 *     A null `expected_tip_hash` ONLY succeeds when the partition is empty.
 *   - **CL-EventStore-4** duplicate-reject: same event_id ⇒ DuplicateEvent.
 *   - **CL-EventStore-5** partition_key.scope mismatch ⇒ PartitionScopeMismatch.
 *   - **CL-EventStore-6** replay-determinism: read() returns events in stable
 *     monotonic-sequence order (the append order).
 *   - **CL-EventStore-7** nonce-mediated collision: same payload + distinct
 *     nonce ⇒ both events accepted (different event_ids).
 *   - **Fix-A1** mutating events without nonce ⇒ NonceRequired (T2.3).
 *
 * Errors are surfaced through {@link EventError} sealed union; this adapter
 * NEVER throws.
 */
export const makeInMemoryEventStore = (
  config: InMemoryEventStoreConfig = {},
): InMemoryEventStoreHandle => {
  const verifyEventId = config.verifyEventId ?? true;
  const completionScope = config.partitionScopeForCompletion ?? "activity";
  const partitions = new Map<string, PartitionState>();

  const requireMatchingScope = (
    pk: PartitionKey,
  ): EventError | null => {
    if (config.expectedScope === undefined) return null;
    if (pk.scope === config.expectedScope) return null;
    return {
      _tag: "PartitionScopeMismatch" as const,
      expected_scope: config.expectedScope,
      actual_scope: pk.scope,
    };
  };

  const getOrCreatePartition = (pk: PartitionKey): PartitionState => {
    const key = partitionKeyToString(pk);
    const existing = partitions.get(key);
    if (existing !== undefined) return existing;
    const fresh: PartitionState = {
      partition_key: pk,
      events: [],
      eventIds: new Set<EventId>(),
      tip: null,
    };
    partitions.set(key, fresh);
    return fresh;
  };

  const contract: EventStoreContract = {
    append: (event, options) =>
      Effect.gen(function* () {
        // Scope check first — cheapest rejection
        const scopeErr = requireMatchingScope(options.partition_key);
        if (scopeErr !== null) return yield* Effect.fail(scopeErr);

        // Fix-A1 — mutating events MUST carry caller-supplied nonce. The
        // adapter is the second line of defense after computeEventId; if a
        // caller hand-constructs an event with a fake event_id and no nonce,
        // we still reject here.
        if (isMutatingEvent(event) && event.nonce === null) {
          return yield* Effect.fail(
            NonceRequired.make({
              event_type: event.$id,
              reason: "mutating events require caller-supplied nonce (Fix-A1)",
            }),
          );
        }

        // Optional: re-verify event_id matches computeEventId(event) to catch
        // adapter-side tampering or A6 violations.
        if (verifyEventId) {
          const computed = yield* computeEventId(event as Record<string, unknown> & {
            readonly $id: string;
            readonly nonce: string | null;
          });
          if (computed !== (event.event_id as unknown as string)) {
            return yield* Effect.fail({
              _tag: "SchemaValidation" as const,
              event_type: event.$id,
              detail: `event_id ${String(event.event_id)} does not match canonical hash ${computed}`,
            });
          }
        }

        const partition = getOrCreatePartition(options.partition_key);

        // CL-EventStore-3 CAS check
        if (options.expected_tip_hash !== partition.tip) {
          return yield* Effect.fail(
            CASFailed.make({
              expected_version: partition.events.length,
              actual_version: partition.events.length,
            }),
          );
        }

        // CL-EventStore-4 duplicate-reject
        if (partition.eventIds.has(event.event_id)) {
          return yield* Effect.fail(
            DuplicateEvent.make({
              existing_event_id: event.event_id as unknown as string,
            }),
          );
        }

        partition.events.push(event);
        partition.eventIds.add(event.event_id);
        partition.tip = event.event_id;
        return {
          partition_key: partition.partition_key,
          tip_event_id: partition.tip,
          monotonic_sequence: partition.events.length,
        } as TipDescriptor;
      }) as Effect.Effect<TipDescriptor, EventError>,

    getTip: (partition) =>
      Effect.gen(function* () {
        const scopeErr = requireMatchingScope(partition);
        if (scopeErr !== null) return yield* Effect.fail(scopeErr);
        const state = partitions.get(partitionKeyToString(partition));
        if (state === undefined) {
          return {
            partition_key: partition,
            tip_event_id: null,
            monotonic_sequence: 0,
          } as TipDescriptor;
        }
        return {
          partition_key: state.partition_key,
          tip_event_id: state.tip,
          monotonic_sequence: state.events.length,
        } as TipDescriptor;
      }),

    read: (partition, after_sequence = 0) =>
      Effect.gen(function* () {
        const scopeErr = requireMatchingScope(partition);
        if (scopeErr !== null) return yield* Effect.fail(scopeErr);
        const state = partitions.get(partitionKeyToString(partition));
        if (state === undefined) return [] as ReadonlyArray<EventEnvelope>;
        if (after_sequence < 0) return state.events.slice();
        return state.events.slice(after_sequence);
      }),
  };

  /**
   * Derives the canonical partition key for an ActivityCompleted event.
   * Default: scope=activity · value=activity_id. World adapters that index
   * differently (per-identity · per-world) override partitionScopeForCompletion
   * AND supply the appropriate value mapping — left as a future exercise.
   */
  const partitionForCompletion = (event: ActivityCompleted): PartitionKey =>
    ({
      scope: completionScope,
      value: event.activity_id as unknown as string,
    }) as PartitionKey;

  const port: CompletionEventPort = {
    emit: (event) =>
      Effect.gen(function* () {
        const pk = partitionForCompletion(event);
        const tip = yield* contract.getTip(pk);
        yield* contract.append(event as unknown as EventEnvelope, {
          partition_key: pk,
          expected_tip_hash: tip.tip_event_id,
        });
        return event.event_id;
      }) as Effect.Effect<EventId, EventError>,

    query: (filter: EventFilter) =>
      Effect.gen(function* () {
        // Cross-partition query: walk every partition's events and filter.
        // For in-memory test fixtures this is fine; production adapters
        // pushdown the filter to the underlying store.
        const all: ActivityCompleted[] = [];
        for (const state of partitions.values()) {
          for (const env of state.events) {
            // Only ActivityCompleted events are emitted via port.emit (see
            // partitionForCompletion). Other event types may be present if
            // the contract was used directly; skip those.
            if (env.$id !== "https://schemas.freeside.thj/activity-completed/v1.0.0") {
              continue;
            }
            const ac = env as unknown as ActivityCompleted;
            if (filter.activity_id !== undefined && ac.activity_id !== filter.activity_id) continue;
            if (filter.identity_id !== undefined && ac.identity_id !== filter.identity_id) continue;
            if (
              filter.source_event_hash !== undefined &&
              ac.source_event_hash !== filter.source_event_hash
            ) {
              continue;
            }
            if (filter.ts_after !== undefined && ac.ts <= filter.ts_after) continue;
            if (filter.ts_before !== undefined && ac.ts >= filter.ts_before) continue;
            all.push(ac);
            if (filter.limit !== undefined && all.length >= filter.limit) break;
          }
          if (filter.limit !== undefined && all.length >= filter.limit) break;
        }
        return all as ReadonlyArray<ActivityCompleted>;
      }) as Effect.Effect<ReadonlyArray<ActivityCompleted>, EventError>,
  };

  return {
    contract,
    port,
    snapshot: () =>
      [...partitions.values()].map((s) => ({
        partition_key: s.partition_key,
        events: s.events.slice(),
      })),
    clear: () => partitions.clear(),
  };
};

// Re-export Schema for adapters that want to decode unknown inputs through
// the protocol schemas before append. Not load-bearing but reduces import
// surface for callers.
export { Schema };
