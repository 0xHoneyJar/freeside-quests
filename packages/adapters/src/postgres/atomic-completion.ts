/**
 * Postgres ATOMIC append-and-grant unit-of-work — Seam-B atomicity bridge
 * (T-A2 · Lane A · SDD §12.1 — the central correctness correction).
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 *
 * The legacy surface did completion+reward in ONE atomic idempotent stored proc
 * (`complete_activity_step_tx`, cubquests-interface/lib/activities/service.ts).
 * The engine-side parity thesis (SDD §3) decomposes that into:
 *
 *     append(CompletionEvent)  →  RewardPort.grant(...)
 *
 * but the NAÏVE decomposition runs those as TWO independent transactions:
 *   - the T-A1 event-store append opens its own pg client (BEGIN…COMMIT);
 *   - the T-A1 reward grant opens ANOTHER client via pool.query (autocommit).
 *
 * A crash BETWEEN them yields:
 *   - completed-activity-WITHOUT-reward (append committed, grant never ran), OR
 *   - double-grant on retry (append's duplicate-reject fires, but the FIRST
 *     attempt had already granted into a separate committed txn).
 *
 * This unit-of-work restores the stored proc's single-transaction atomicity:
 * {CAS event-append → reward_grants write → apply_resource_mutation} all run on
 * ONE checked-out pg client, inside ONE `BEGIN ISOLATION LEVEL SERIALIZABLE …
 * COMMIT`. A failure at ANY step rolls back ALL of them. There is exactly one
 * COMMIT; there is no window in which the event is durable but the balance is
 * not (or vice-versa).
 *
 * ── Why a new seam (and not "extend RewardPort") ─────────────────────────────
 *
 * The sealed `RewardPort.grant` / `EventStoreContract.append` contracts each
 * own their OWN connection lifecycle — that is correct for their standalone
 * conformance (the T-A1 suites prove CAS + D18 in isolation, and MUST keep
 * passing unmodified). A shared transaction CANNOT be expressed through those
 * port signatures without leaking a pg client across the contract boundary.
 * So per SDD §12.1's explicit allowance ("if a shared txn requires a new seam,
 * ADD that seam minimally"), this is a SEPARATE composition that reuses the
 * SAME mechanisms (FOR UPDATE CAS, PK-based duplicate-reject, the existing
 * stored proc) but binds them to one client. It does NOT bolt balances onto the
 * engine (NG-1): balances stay in cubquest-db's `user_resources` ledger; this
 * bridge calls the EXISTING `apply_resource_mutation` proc — it does NOT invent
 * a second balance store and does NOT write `resource_transactions` directly
 * (the proc owns that row).
 *
 * ── Idempotency composition (no double-grant on retry) ───────────────────────
 *
 * Three idempotency keys compose so a retry of the SAME completion is a no-op:
 *
 *   1. event_store PRIMARY KEY (event_id)            → CL-EventStore-4
 *   2. reward_grants PRIMARY KEY (originating_event_id, recipient) → CL-Reward-2/D18
 *   3. apply_resource_mutation's `p_idempotency_key` → resource_transactions
 *      (idempotency_key, user_address) uniqueness inside cubquest-db.
 *
 * On the FIRST attempt all three insert. On a RETRY of the same completion the
 * event_id duplicate-reject (23505) fires FIRST, aborts the whole transaction,
 * and NOTHING downstream runs — so the balance is never touched twice. The
 * apply_resource_mutation idempotency key is belt-and-suspenders for the case
 * where a retry somehow reaches the proc with a fresh event_id but the same
 * logical completion (it returns zero-deltas, not a second grant).
 *
 * ── apply_resource_mutation signature (grounded) ─────────────────────────────
 *
 * cubquests-interface/supabase/migrations/20251102231328_fix_apply_resource_mutation_return_deltas.sql:
 *
 *   apply_resource_mutation(
 *     p_user_address  text,
 *     p_source_type   text,
 *     p_common        integer DEFAULT 0,
 *     p_rare          integer DEFAULT 0,
 *     p_legendary     integer DEFAULT 0,
 *     p_source_id     text    DEFAULT NULL,
 *     p_metadata      jsonb   DEFAULT '{}',
 *     p_idempotency_key text  DEFAULT NULL,
 *     p_authorizer    text    DEFAULT NULL
 *   ) RETURNS TABLE(common int, rare int, legendary int,
 *                   common_transaction_id uuid, rare_transaction_id uuid,
 *                   legendary_transaction_id uuid)
 *
 * It runs `SELECT … FOR UPDATE` on user_resources then UPDATE + INSERT into
 * resource_transactions — all in the CALLER's transaction (plpgsql functions
 * inherit the caller's txn). That is exactly what makes calling it on our
 * checked-out client roll back atomically with the event append.
 */

import { Effect } from "effect";

import {
  type ActivityReward,
  CASFailed,
  computeEventId,
  DuplicateEvent,
  type EventEnvelope,
  type EventError,
  type EventId,
  type IdentityId,
  isMutatingEvent,
  NonceRequired,
  type PartitionKey,
  RewardAdapterUnavailable,
  RewardAlreadyGranted,
  type RewardError,
  type RewardGranted,
  RFC3339Date,
  SchemaValidation,
} from "@0xhoneyjar/quests-protocol";

import { Schema } from "effect";

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

type RewardGrantedRecord = Schema.Schema.Type<typeof RewardGranted>;

/** Decode an ISO-8601 string into the protocol's branded RFC3339Date. */
const RFC3339 = Schema.decodeUnknownSync(RFC3339Date);

/**
 * AtomicCompletionError — sealed union surfaced by {@link grantAndComplete}.
 *
 * It is the SUPERSET of EventError ∪ RewardError plus the two resource-mutation
 * outcomes the proc can raise (insufficient balance / proc unavailable). The
 * caller (engine completion flow) pattern-matches on `_tag`; every variant is
 * already a sealed protocol tag except `ResourceMutationFailed`.
 */
export const ResourceMutationFailed = Schema.TaggedStruct("ResourceMutationFailed", {
  reason: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512)),
  retryable: Schema.Boolean,
});
export type ResourceMutationFailed = Schema.Schema.Type<typeof ResourceMutationFailed>;

export type AtomicCompletionError =
  | EventError
  | RewardError
  | ResourceMutationFailed;

/**
 * The reward delta translated for `apply_resource_mutation`. The engine maps an
 * {@link ActivityReward} intent into the three resource tiers BEFORE handing it
 * to the unit-of-work (resource semantics live in the engine, not the adapter).
 * `None` rewards pass `{0,0,0}` and the proc short-circuits (no-op, no ledger
 * row) — the event still appends + a grant row is still recorded (the grant of
 * a None reward is "completion is the reward", CL-Reward-1).
 */
export interface ResourceMutationDelta {
  readonly common: number;
  readonly rare: number;
  readonly legendary: number;
}

export interface GrantAndCompleteInput {
  /** The CompletionEvent envelope to append (ActivityCompleted). */
  readonly event: EventEnvelope;
  /** Partition + CAS tip assertion (same shape EventStoreContract.append takes). */
  readonly partition_key: PartitionKey;
  readonly expected_tip_hash: EventId | null;
  /** The reward intent (stored verbatim in reward_grants for audit). */
  readonly reward: ActivityReward;
  /** The grant recipient (also the reward_grants idempotency key half). */
  readonly recipient: IdentityId;
  /**
   * The on-chain / ledger address apply_resource_mutation keys balances on.
   * Resolved by the engine via IdentityResolverPort BEFORE the txn opens — the
   * unit-of-work does NOT resolve identity (it must hold the txn open as
   * briefly as possible; identity resolution may be a network call).
   */
  readonly userAddress: string;
  /** Resource deltas to apply (engine-translated from `reward`). */
  readonly delta: ResourceMutationDelta;
  /**
   * Idempotency key threaded into apply_resource_mutation. MUST be derived
   * deterministically from the completion (the originating event_id is the
   * canonical choice) so a retry of the same completion is a proc no-op.
   */
  readonly resourceIdempotencyKey: string;
  /** source_type recorded on the ledger row (e.g. "activity_completion"). */
  readonly sourceType: string;
  /** Optional source_id (e.g. the activity_id) recorded on the ledger row. */
  readonly sourceId?: string;
}

export interface PostgresAtomicCompletionConfig {
  readonly pool: EventStorePostgresPool;
  /** event_store table name. Default "event_store". */
  readonly eventTableName?: string;
  /** reward_grants table name. Default "reward_grants". */
  readonly rewardTableName?: string;
  /** Stored-proc name. Default "apply_resource_mutation". */
  readonly resourceMutationFn?: string;
  /** When true, append re-runs computeEventId and rejects mismatch. Default true. */
  readonly verifyEventId?: boolean;
  /** Max retries on SERIALIZABLE serialization-failure (40001). Default 8. */
  readonly maxSerializationRetries?: number;
  /** Synthetic granted_event_id provider. Default deterministic counter. */
  readonly nextGrantedEventIdProvider?: () => EventId;
  readonly timestampProvider?: () => string;
  /**
   * TEST-ONLY crash injector. Invoked at the named seam INSIDE the open
   * transaction, BEFORE COMMIT. Throwing from it aborts the txn → the whole
   * unit-of-work rolls back (proves atomicity). NEVER set in production.
   */
  readonly __crashAfter?: (
    seam: "append" | "reward-grant" | "resource-mutation",
  ) => void;
}

export interface PostgresAtomicCompletionHandle {
  /**
   * grantAndComplete — the atomic unit-of-work. Appends the completion event,
   * records the reward grant, AND applies the resource mutation in ONE
   * Postgres transaction. Returns the RewardGranted record on success.
   *
   * NEVER throws out of the Effect — every failure mode is a sealed
   * AtomicCompletionError, and every failure rolls back the transaction.
   */
  readonly grantAndComplete: (
    input: GrantAndCompleteInput,
  ) => Effect.Effect<RewardGrantedRecord, AtomicCompletionError>;
}

interface TipRow extends QueryResultRow {
  readonly event_id: string;
  readonly monotonic_sequence: string | number;
}

const partitionKeyToString = (pk: PartitionKey): string => `${pk.scope}::${pk.value}`;

const toInt = (v: string | number): number =>
  typeof v === "number" ? v : Number.parseInt(v, 10);

const isObjErr = (v: unknown): v is { readonly _tag: string } =>
  typeof v === "object" && v !== null && "_tag" in v;

export const makePostgresAtomicCompletion = (
  config: PostgresAtomicCompletionConfig,
): PostgresAtomicCompletionHandle => {
  const { pool } = config;
  const eventTable = config.eventTableName ?? "event_store";
  const rewardTable = config.rewardTableName ?? "reward_grants";
  const resourceFn = config.resourceMutationFn ?? "apply_resource_mutation";
  const verifyEventId = config.verifyEventId ?? true;
  const maxRetries = config.maxSerializationRetries ?? 8;
  const crashAfter = config.__crashAfter;

  let counter = 0;
  const defaultGrantedEventId = (): EventId => {
    counter += 1;
    return counter.toString(16).padStart(64, "e") as unknown as EventId;
  };
  const grantedEventIdProvider =
    config.nextGrantedEventIdProvider ?? defaultGrantedEventId;
  const timestampProvider =
    config.timestampProvider ?? (() => new Date().toISOString());

  /**
   * The whole unit-of-work as one async transaction, returning either the
   * granted record OR a sealed error. The retry loop wraps the entire txn so a
   * 40001 (serialization failure) on the empty-partition race re-runs the WHOLE
   * thing — re-running is safe because the FIRST thing the retried txn does is
   * the event_id duplicate-reject / CAS check, so it cannot double-apply.
   */
  const run = async (
    input: GrantAndCompleteInput,
  ): Promise<RewardGrantedRecord | AtomicCompletionError> => {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const client: EventStorePostgresClient = await pool.connect();
      let began = false;
      try {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        began = true;

        const scope = input.partition_key.scope;
        const value = input.partition_key.value;

        // ── STEP 1: CAS event-append (reuses the T-A1 mechanism, on OUR client)
        //
        // SELECT … FOR UPDATE locks the partition tip; SERIALIZABLE covers the
        // empty-partition race. Identical CAS semantics to event-store.ts, but
        // bound to this transaction so it shares the COMMIT with steps 2 + 3.
        const tipRes = await client.query<TipRow>(
          `SELECT event_id, monotonic_sequence
             FROM ${eventTable}
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

        if (input.expected_tip_hash !== currentTip) {
          await client.query("ROLLBACK");
          let expectedVersion = 0;
          if (input.expected_tip_hash !== null) {
            const evRes = await client.query<{ monotonic_sequence: string | number }>(
              `SELECT monotonic_sequence FROM ${eventTable}
                WHERE scope = $1 AND partition_value = $2 AND event_id = $3
                LIMIT 1`,
              [scope, value, input.expected_tip_hash as unknown as string],
            );
            const r = evRes.rows[0];
            expectedVersion = r === undefined ? 0 : toInt(r.monotonic_sequence);
          }
          return CASFailed.make({
            expected_version: expectedVersion,
            actual_version: currentSeq,
          });
        }

        const nextSeq = currentSeq + 1;
        try {
          await client.query(
            `INSERT INTO ${eventTable}
               (event_id, scope, partition_value, partition_key, monotonic_sequence, event_envelope)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
            [
              input.event.event_id as unknown as string,
              scope,
              value,
              partitionKeyToString(input.partition_key),
              nextSeq,
              JSON.stringify(input.event),
            ],
          );
        } catch (insertErr) {
          await client.query("ROLLBACK");
          const code = pgErrorCode(insertErr);
          if (code === PG_UNIQUE_VIOLATION) {
            const constraint = pgConstraint(insertErr);
            if (constraint === "event_store_partition_seq_uniq" && attempt < maxRetries) {
              attempt += 1;
              continue;
            }
            // event_id PK violation ⇒ this completion already appended.
            // CRITICAL: we roll back here, so the reward + ledger NEVER ran —
            // a retry of an already-applied completion is a clean no-op, NOT a
            // double-grant. (CL-EventStore-4 composing with idempotency.)
            return DuplicateEvent.make({
              existing_event_id: input.event.event_id as unknown as string,
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

        // TEST-ONLY crash seam: a crash HERE (event durable in this txn, but not
        // yet committed) must roll BOTH back. Throwing lands in the catch below.
        if (crashAfter !== undefined) crashAfter("append");

        // ── STEP 2: reward_grants write (Pending→Granted), D18 idempotency ────
        //
        // The (originating_event_id, recipient) PRIMARY KEY is the idempotency
        // guard. On the SAME client, so it commits with steps 1 + 3.
        const grantedEventId = grantedEventIdProvider();
        const ts = timestampProvider();
        try {
          await client.query(
            `INSERT INTO ${rewardTable}
               (originating_event_id, recipient, granted_event_id, reward, ts)
             VALUES ($1, $2, $3, $4::jsonb, $5)`,
            [
              input.event.event_id as unknown as string,
              input.recipient as unknown as string,
              grantedEventId as unknown as string,
              JSON.stringify(input.reward),
              ts,
            ],
          );
        } catch (grantErr) {
          if (pgErrorCode(grantErr) === PG_UNIQUE_VIOLATION) {
            // A grant for this (event, recipient) already exists. Because the
            // event_id PK would normally have rejected first, reaching here
            // means a prior PARTIAL run committed the grant. Roll back our
            // event append (it would otherwise be a fresh duplicate path) and
            // surface AlreadyGranted carrying the existing grant id.
            await client.query("ROLLBACK");
            const existing = await client.query<{ granted_event_id: string }>(
              `SELECT granted_event_id FROM ${rewardTable}
                WHERE originating_event_id = $1 AND recipient = $2 LIMIT 1`,
              [
                input.event.event_id as unknown as string,
                input.recipient as unknown as string,
              ],
            );
            const g = existing.rows[0];
            return RewardAlreadyGranted.make({
              originating_event_id: input.event.event_id as unknown as EventId,
              existing_grant_id: (g?.granted_event_id ??
                input.event.event_id) as unknown as EventId,
            });
          }
          throw grantErr;
        }

        if (crashAfter !== undefined) crashAfter("reward-grant");

        // ── STEP 3: apply_resource_mutation — bridge into cubquest-db ledger ──
        //
        // Called on the SAME client → runs in THIS transaction. The proc does
        // SELECT … FOR UPDATE on user_resources + UPDATE + INSERT into
        // resource_transactions, all of which roll back with us. We do NOT
        // write resource_transactions ourselves (NG-1 + §12.1: the proc owns
        // that row). A None reward yields {0,0,0} → the proc no-ops.
        const { common, rare, legendary } = input.delta;
        if (common !== 0 || rare !== 0 || legendary !== 0) {
          try {
            await client.query(
              `SELECT * FROM ${resourceFn}(
                 $1::text, $2::text, $3::integer, $4::integer, $5::integer,
                 $6::text, $7::jsonb, $8::text, $9::text
               )`,
              [
                input.userAddress,
                input.sourceType,
                common,
                rare,
                legendary,
                input.sourceId ?? null,
                JSON.stringify({ idempotencyKey: input.resourceIdempotencyKey }),
                input.resourceIdempotencyKey,
                null,
              ],
            );
          } catch (mutErr) {
            await client.query("ROLLBACK");
            const code = pgErrorCode(mutErr);
            // Serialization failures retry the whole unit-of-work.
            if (
              (code === PG_SERIALIZATION_FAILURE || code === PG_DEADLOCK_DETECTED) &&
              attempt < maxRetries
            ) {
              attempt += 1;
              continue;
            }
            const message = String(
              mutErr instanceof Error ? mutErr.message : mutErr,
            );
            // insufficient-balance is the proc's deterministic, non-retryable
            // RAISE; anything else is treated as a (retryable) infra fault.
            const insufficient = message.includes("resource-insufficient");
            return ResourceMutationFailed.make({
              reason: `apply_resource_mutation failed: ${message}`.slice(0, 512),
              retryable: !insufficient,
            });
          }
        }

        if (crashAfter !== undefined) crashAfter("resource-mutation");

        // ── COMMIT — the ONE commit. Steps 1+2+3 become durable together. ─────
        await client.query("COMMIT");

        return {
          _tag: "RewardGranted",
          reward: input.reward,
          originating_event_id: input.event.event_id as unknown as EventId,
          granted_event_id: grantedEventId,
          ts: RFC3339(ts),
        } satisfies RewardGrantedRecord;
      } catch (txErr) {
        if (began) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* connection may already be aborted */
          }
        }
        const code = pgErrorCode(txErr);
        if (
          (code === PG_SERIALIZATION_FAILURE || code === PG_DEADLOCK_DETECTED) &&
          attempt < maxRetries
        ) {
          attempt += 1;
          continue;
        }
        return RewardAdapterUnavailable.make({
          adapter_id: "postgres:atomic-completion",
          reason: `atomic completion failed: ${String(
            txErr instanceof Error ? txErr.message : txErr,
          )}`.slice(0, 512),
        });
      } finally {
        client.release();
      }
    }
  };

  const grantAndComplete = (
    input: GrantAndCompleteInput,
  ): Effect.Effect<RewardGrantedRecord, AtomicCompletionError> =>
    Effect.gen(function* () {
      // Fix-A1: mutating events MUST carry a caller-supplied nonce — same
      // pre-flight guard the standalone event-store applies, BEFORE we open a
      // transaction (cheapest rejection first).
      const ev = input.event as EventEnvelope & {
        readonly $id: string;
        readonly nonce: string | null;
      };
      if (isMutatingEvent(input.event) && ev.nonce === null) {
        return yield* Effect.fail(
          NonceRequired.make({
            event_type: ev.$id,
            reason: "mutating events require caller-supplied nonce (Fix-A1)",
          }) as AtomicCompletionError,
        );
      }

      if (verifyEventId) {
        const computed = yield* computeEventId(
          input.event as Record<string, unknown> & {
            readonly $id: string;
            readonly nonce: string | null;
          },
        );
        if (computed !== (input.event.event_id as unknown as string)) {
          return yield* Effect.fail(
            SchemaValidation.make({
              event_type: ev.$id,
              detail: `event_id ${String(input.event.event_id)} does not match canonical hash ${computed}`,
            }) as AtomicCompletionError,
          );
        }
      }

      const result = yield* Effect.promise(() => run(input));
      if (isObjErr(result) && result._tag !== "RewardGranted") {
        return yield* Effect.fail(result as AtomicCompletionError);
      }
      return result as RewardGrantedRecord;
    }) as Effect.Effect<RewardGrantedRecord, AtomicCompletionError>;

  return { grantAndComplete };
};
