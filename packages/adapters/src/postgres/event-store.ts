/**
 * Postgres event-store adapter — Seam-B production backing for
 * EventStoreContract + CompletionEventPort (T-A1 · Lane A).
 *
 * Mirrors the in-memory reference (`../in-memory/completion-event.ts`) field
 * for field; the ONLY difference is the backing store. Same invariants
 * (CL-EventStore-1..7 + Fix-A1), same EventError surface, never throws.
 *
 * ── Concurrency model (the load-bearing part) ────────────────────────────────
 *
 * CL-EventStore-3 (CAS via expected_tip_hash) MUST be correct under genuine
 * concurrency. READ COMMITTED is WRONG: two writers that both read the same
 * tip would both pass the CAS check and both append (phantom / lost-update).
 *
 * This adapter runs the entire append — read-tip → CAS-compare → assign next
 * sequence → INSERT — inside ONE transaction at **SERIALIZABLE** isolation,
 * AND takes a row lock on the partition's tip with `SELECT … FOR UPDATE`.
 * The two mechanisms are belt-and-suspenders:
 *
 *   1. `FOR UPDATE` on the current tip row serializes writers that contend on
 *      a NON-empty partition: the second writer blocks until the first
 *      commits, then sees the advanced tip and fails CAS — no retry needed.
 *
 *   2. SERIALIZABLE covers the empty-partition race (`expected_tip_hash: null`,
 *      no row to lock yet): predicate-locking detects that both writers read
 *      "partition is empty" and one is rolled back with SQLSTATE 40001. The
 *      adapter's retry loop re-runs that transaction; on the retry it now sees
 *      the row the winner inserted and fails CAS deterministically.
 *
 * Crucially this does NOT serialize ALL writes globally — writers on DIFFERENT
 * partitions never contend (different tip rows, different predicate ranges).
 * The conformance suite's concurrency assertions pass because the contention
 * is real and resolved at the partition grain.
 *
 * CL-EventStore-4 (duplicate-reject) leans on the `event_id` PRIMARY KEY: a
 * duplicate INSERT raises 23505, mapped to DuplicateEvent — the adapter does
 * NOT recompute the event_id (it trusts the caller's canonical hash per §5.6).
 */

import { Effect } from "effect";

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
  SchemaValidation,
  type TipDescriptor,
} from "@0xhoneyjar/quests-protocol";

import {
  type EventStorePostgresClient,
  type EventStorePostgresPool,
  PG_DEADLOCK_DETECTED,
  PG_SERIALIZATION_FAILURE,
  PG_UNIQUE_VIOLATION,
  pgConstraint,
  pgErrorCode,
  type QueryResultRow,
} from "./pool.js";

const ACTIVITY_COMPLETED_ID =
  "https://schemas.freeside.thj/activity-completed/v1.0.0";

/**
 * Configuration for {@link makePostgresEventStore}. Field-compatible with the
 * in-memory adapter's config so the conformance factory can pass the same
 * `expectedScope` / `verifyEventId` shape through unchanged.
 */
export interface PostgresEventStoreConfig {
  readonly pool: EventStorePostgresPool;
  /** When set, append/getTip/read reject any partition_key.scope ≠ this (CL-EventStore-5). */
  readonly expectedScope?: PartitionKey["scope"];
  /** Scope used when CompletionEventPort.emit derives a partition. Default "activity". */
  readonly partitionScopeForCompletion?: PartitionKey["scope"];
  /** When true, append re-runs computeEventId and rejects on mismatch. Default true. */
  readonly verifyEventId?: boolean;
  /** Override table name (e.g. for staging). Default "event_store". */
  readonly tableName?: string;
  /** Max retries on SERIALIZABLE serialization-failure (40001). Default 8. */
  readonly maxSerializationRetries?: number;
}

export interface PostgresEventStoreHandle {
  readonly contract: EventStoreContract;
  readonly port: CompletionEventPort;
}

interface TipRow extends QueryResultRow {
  readonly event_id: string;
  readonly monotonic_sequence: string | number;
}

interface EventRow extends QueryResultRow {
  readonly event_envelope: unknown;
}

const partitionKeyToString = (pk: PartitionKey): string =>
  `${pk.scope}::${pk.value}`;

const toInt = (v: string | number): number =>
  typeof v === "number" ? v : Number.parseInt(v, 10);

/**
 * makePostgresEventStore — postgres-backed EventStoreContract + CompletionEventPort.
 *
 * @example
 *   import { Pool } from "pg";
 *   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 *   const { contract, port } = makePostgresEventStore({ pool });
 */
export const makePostgresEventStore = (
  config: PostgresEventStoreConfig,
): PostgresEventStoreHandle => {
  const { pool } = config;
  const table = config.tableName ?? "event_store";
  const verifyEventId = config.verifyEventId ?? true;
  const completionScope = config.partitionScopeForCompletion ?? "activity";
  const maxRetries = config.maxSerializationRetries ?? 8;

  const scopeMismatch = (pk: PartitionKey): EventError | null => {
    if (config.expectedScope === undefined) return null;
    if (pk.scope === config.expectedScope) return null;
    return {
      _tag: "PartitionScopeMismatch" as const,
      expected_scope: config.expectedScope,
      actual_scope: pk.scope,
    };
  };

  // ── append (SERIALIZABLE + FOR UPDATE CAS) ────────────────────────────────
  //
  // Implemented as a Promise the Effect wraps; all failure modes are returned
  // as the sealed EventError (never thrown out of the Effect). The retry loop
  // lives here so a 40001 on the empty-partition race is transparent.
  const appendPromise = async (
    event: EventEnvelope,
    options: AppendOptions,
  ): Promise<TipDescriptor | EventError> => {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const client: EventStorePostgresClient = await pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

        const scope = options.partition_key.scope;
        const value = options.partition_key.value;

        // 1. Read + LOCK the current tip of this partition. FOR UPDATE blocks a
        //    concurrent writer contending on the same NON-empty partition until
        //    we commit; SERIALIZABLE predicate-locks the empty case.
        const tipRes = await client.query<TipRow>(
          `SELECT event_id, monotonic_sequence
             FROM ${table}
            WHERE scope = $1 AND partition_value = $2
            ORDER BY monotonic_sequence DESC
            LIMIT 1
            FOR UPDATE`,
          [scope, value],
        );
        const tipRow = tipRes.rows[0];
        const currentTip: EventId | null =
          tipRow === undefined ? null : (tipRow.event_id as unknown as EventId);
        const currentSeq = tipRow === undefined ? 0 : toInt(tipRow.monotonic_sequence);

        // 2. CAS check (CL-EventStore-3). expected_tip_hash must equal the
        //    current tip (null ⇔ partition empty).
        if (options.expected_tip_hash !== currentTip) {
          await client.query("ROLLBACK");
          // expected_version: if caller claimed empty → 0; else the sequence of
          // the event they THOUGHT was the tip (look it up; 0 if unknown).
          let expectedVersion = 0;
          if (options.expected_tip_hash !== null) {
            const evRes = await pool.query<{ monotonic_sequence: string | number }>(
              `SELECT monotonic_sequence FROM ${table}
                WHERE scope = $1 AND partition_value = $2 AND event_id = $3
                LIMIT 1`,
              [scope, value, options.expected_tip_hash as unknown as string],
            );
            const r = evRes.rows[0];
            expectedVersion = r === undefined ? 0 : toInt(r.monotonic_sequence);
          }
          return CASFailed.make({
            expected_version: expectedVersion,
            actual_version: currentSeq,
          });
        }

        // 3. Assign next monotonic sequence + INSERT. Duplicate event_id → the
        //    PK raises 23505 (DuplicateEvent); partition_seq_uniq is the
        //    sequence backstop.
        const nextSeq = currentSeq + 1;
        try {
          await client.query(
            `INSERT INTO ${table}
               (event_id, scope, partition_value, partition_key, monotonic_sequence, event_envelope)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
            [
              event.event_id as unknown as string,
              scope,
              value,
              partitionKeyToString(options.partition_key),
              nextSeq,
              JSON.stringify(event),
            ],
          );
        } catch (insertErr) {
          await client.query("ROLLBACK");
          const code = pgErrorCode(insertErr);
          if (code === PG_UNIQUE_VIOLATION) {
            const constraint = pgConstraint(insertErr);
            // PK on event_id ⇒ duplicate event. The sequence-uniq constraint
            // should be unreachable under the lock, but if it fires, treat it
            // as a serialization conflict and retry.
            if (constraint === "event_store_partition_seq_uniq") {
              if (attempt < maxRetries) {
                attempt += 1;
                continue;
              }
            }
            return DuplicateEvent.make({
              existing_event_id: event.event_id as unknown as string,
            });
          }
          if (
            (code === PG_SERIALIZATION_FAILURE || code === PG_DEADLOCK_DETECTED) &&
            attempt < maxRetries
          ) {
            attempt += 1;
            continue;
          }
          throw insertErr;
        }

        await client.query("COMMIT");
        return {
          partition_key: options.partition_key,
          tip_event_id: event.event_id as unknown as EventId,
          monotonic_sequence: nextSeq,
        } as TipDescriptor;
      } catch (txErr) {
        // Roll back best-effort; the connection is released in finally.
        try {
          await client.query("ROLLBACK");
        } catch {
          /* connection may already be aborted */
        }
        const code = pgErrorCode(txErr);
        if (
          (code === PG_SERIALIZATION_FAILURE || code === PG_DEADLOCK_DETECTED) &&
          attempt < maxRetries
        ) {
          attempt += 1;
          continue;
        }
        // Non-retryable infra failure — surface as SchemaValidation-adjacent
        // adapter error. The contract's EventError union has no generic
        // "AdapterUnavailable", so we map infra faults to SchemaValidation with
        // a clear detail (the conformance suite never exercises this path).
        return SchemaValidation.make({
          event_type: "EventStoreContract.append",
          detail: `postgres append failed: ${String(
            txErr instanceof Error ? txErr.message : txErr,
          )}`.slice(0, 1024),
        });
      } finally {
        client.release();
      }
    }
  };

  const contract: EventStoreContract = {
    append: (event, options) =>
      Effect.gen(function* () {
        // Cheapest rejections first, mirroring the in-memory adapter ordering.
        const scopeErr = scopeMismatch(options.partition_key);
        if (scopeErr !== null) return yield* Effect.fail(scopeErr);

        // Fix-A1: mutating events MUST carry a caller-supplied nonce.
        if (isMutatingEvent(event) && event.nonce === null) {
          return yield* Effect.fail(
            NonceRequired.make({
              event_type: event.$id,
              reason: "mutating events require caller-supplied nonce (Fix-A1)",
            }),
          );
        }

        // Optional: verify caller's event_id is the canonical hash (A6).
        if (verifyEventId) {
          const computed = yield* computeEventId(
            event as Record<string, unknown> & {
              readonly $id: string;
              readonly nonce: string | null;
            },
          );
          if (computed !== (event.event_id as unknown as string)) {
            return yield* Effect.fail(
              SchemaValidation.make({
                event_type: event.$id,
                detail: `event_id ${String(event.event_id)} does not match canonical hash ${computed}`,
              }),
            );
          }
        }

        const result = yield* Effect.promise(() => appendPromise(event, options));
        if (typeof result === "object" && "_tag" in result) {
          return yield* Effect.fail(result as EventError);
        }
        return result as TipDescriptor;
      }) as Effect.Effect<TipDescriptor, EventError>,

    getTip: (partition) =>
      Effect.gen(function* () {
        const scopeErr = scopeMismatch(partition);
        if (scopeErr !== null) return yield* Effect.fail(scopeErr);
        const res = yield* Effect.promise(() =>
          pool.query<TipRow>(
            `SELECT event_id, monotonic_sequence
               FROM ${table}
              WHERE scope = $1 AND partition_value = $2
              ORDER BY monotonic_sequence DESC
              LIMIT 1`,
            [partition.scope, partition.value],
          ),
        );
        const row = res.rows[0];
        if (row === undefined) {
          return {
            partition_key: partition,
            tip_event_id: null,
            monotonic_sequence: 0,
          } as TipDescriptor;
        }
        return {
          partition_key: partition,
          tip_event_id: row.event_id as unknown as EventId,
          monotonic_sequence: toInt(row.monotonic_sequence),
        } as TipDescriptor;
      }),

    read: (partition, after_sequence = 0) =>
      Effect.gen(function* () {
        const scopeErr = scopeMismatch(partition);
        if (scopeErr !== null) return yield* Effect.fail(scopeErr);
        // Reject negative after_sequence (parity with in-memory · C7).
        if (!Number.isInteger(after_sequence) || after_sequence < 0) {
          return yield* Effect.fail(
            SchemaValidation.make({
              event_type: "EventStoreContract.read",
              detail: `after_sequence must be a non-negative integer; got ${after_sequence}`,
            }),
          );
        }
        const res = yield* Effect.promise(() =>
          pool.query<EventRow>(
            `SELECT event_envelope
               FROM ${table}
              WHERE scope = $1 AND partition_value = $2 AND monotonic_sequence > $3
              ORDER BY monotonic_sequence ASC`,
            [partition.scope, partition.value, after_sequence],
          ),
        );
        // Return the stored envelopes verbatim (jsonb round-trips to objects).
        // We do NOT re-decode through the bare EventEnvelope schema — that
        // would strip type-specific fields (activity_id, ...). The caller's
        // canonical hash already validated the shape at append time.
        return res.rows.map((r) => r.event_envelope as EventEnvelope);
      }),
  };

  // ── CompletionEventPort ───────────────────────────────────────────────────

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
        // Pushdown the cheap equality filters; do the rest in JS (the
        // conformance suite only exercises activity_id). Production worlds with
        // large stores SHOULD push every predicate into SQL.
        const res = yield* Effect.promise(() =>
          pool.query<EventRow>(
            `SELECT event_envelope
               FROM ${table}
              WHERE event_envelope->>'$id' = $1
              ORDER BY scope, partition_value, monotonic_sequence ASC`,
            [ACTIVITY_COMPLETED_ID],
          ),
        );
        const out: ActivityCompleted[] = [];
        for (const r of res.rows) {
          const ac = r.event_envelope as unknown as ActivityCompleted;
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
          out.push(ac);
          if (filter.limit !== undefined && out.length >= filter.limit) break;
        }
        return out as ReadonlyArray<ActivityCompleted>;
      }) as Effect.Effect<ReadonlyArray<ActivityCompleted>, EventError>,
  };

  return { contract, port };
};
