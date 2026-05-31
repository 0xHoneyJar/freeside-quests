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
 *      PARTIAL-UNIQUE index (user_address, resource_type, idempotency_key)
 *      WHERE idempotency_key IS NOT NULL — grounded in
 *      cubquests-interface/supabase/migrations/
 *        20251102225424_fix_idempotency_key_column_type_to_text.sql
 *      (column-set corrected — defect #21.5: this comment previously named
 *      `(idempotency_key, user_address)`, which is BOTH the wrong order AND
 *      missing `resource_type`).
 *
 * On the FIRST attempt all three insert. On a RETRY of the same completion the
 * event_id duplicate-reject (23505) fires FIRST, aborts the whole transaction,
 * and NOTHING downstream runs — so the balance is never touched twice. The
 * apply_resource_mutation idempotency key is belt-and-suspenders for the case
 * where a retry somehow reaches the proc with a fresh event_id but the same
 * logical completion (it returns zero-deltas, not a second grant — and the
 * bridge now ENFORCES resourceIdempotencyKey === event_id so this case cannot
 * arise from the host's coarse legacy key — defect #21.4).
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
  /**
   * Provenance metadata merged into the ledger row's `metadata` jsonb, mirroring
   * the legacy stored-proc path which writes `{ period_key, step_id }`
   * (cubquests-interface/lib/activities/service.ts:~657-660). Defect #21.9: the
   * bridge previously hard-coded `metadata = { idempotencyKey }`, dropping
   * period_key/step_id — so engine-written ledger rows carried a DISJOINT
   * metadata shape from legacy rows. The bridge now merges
   * `{ ...sourceMetadata, idempotencyKey }` so engine + legacy rows are shape-
   * compatible (idempotencyKey is always appended, matching the proc's own
   * `v_metadata || { idempotencyKey }` behavior in prod).
   */
  readonly sourceMetadata?: Readonly<Record<string, unknown>>;
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
  /**
   * Defect #21.4 layer 1: when true (default), the bridge ENFORCES that
   * `resourceIdempotencyKey === event.event_id` — making the resource ledger key
   * per-event so the host's coarse legacy resource key (activity+period+step)
   * cannot let two distinct-event completions share one resource key (which
   * would no-op the 2nd grant while its event+grant committed → completed-
   * without-reward). Set false ONLY if a caller deliberately supplies a
   * different (still per-event-unique) key shape and accepts responsibility for
   * the invariant.
   */
  readonly enforceResourceKeyIsEventId?: boolean;
  /** Max retries on SERIALIZABLE serialization-failure (40001). Default 8. */
  readonly maxSerializationRetries?: number;
  /**
   * Synthetic granted_event_id provider. Default: DETERMINISTIC derivation from
   * the grant tuple (defect #21.7) — NOT an in-process counter. Override only in
   * tests that need a specific synthetic id.
   */
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

/**
 * The delta columns apply_resource_mutation RETURNS. On an idempotency hit (a
 * ledger row already exists for this idempotency_key) the proc returns
 * {0,0,0}; on a fresh apply it returns the deltas it wrote. Defect #21.4 reads
 * these to detect the zero-delta-with-expected-reward divergence.
 */
interface ProcDeltaRow extends QueryResultRow {
  readonly common: string | number | null;
  readonly rare: string | number | null;
  readonly legendary: string | number | null;
}

const toIntOrZero = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number.parseInt(v, 10);
};

/** Sum the absolute deltas the proc reported as applied across all returned rows. */
const sumProcDelta = (rows: ReadonlyArray<ProcDeltaRow>): number => {
  let total = 0;
  for (const r of rows) {
    total +=
      Math.abs(toIntOrZero(r.common)) +
      Math.abs(toIntOrZero(r.rare)) +
      Math.abs(toIntOrZero(r.legendary));
  }
  return total;
};

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
  const enforceResourceKeyIsEventId = config.enforceResourceKeyIsEventId ?? true;
  const maxRetries = config.maxSerializationRetries ?? 8;
  const crashAfter = config.__crashAfter;

  // Defect #21.7 fix: granted_event_id is now derived DETERMINISTICALLY from the
  // grant's identity tuple (originating_event_id, recipient) — the SAME tuple
  // that is the reward_grants PRIMARY KEY. The prior impl used a per-PROCESS hex
  // counter that (a) reset to 1 on every restart and (b) ran independently per
  // worker, so two workers (or one worker across a redeploy) could mint the SAME
  // synthetic id for DIFFERENT grants. Because granted_event_id has no UNIQUE
  // constraint, that collision was silent — and it corrupts retry.ts's D18
  // AlreadyGranted recovery, whose `.find(g => g.granted_event_id === ...)`
  // would then return the WRONG RewardGrantedRecord.
  //
  // Deriving it via computeEventId over the canonical (originating, recipient,
  // reward) preimage makes it: process-independent, restart-stable, and
  // collision-free across distinct grants (a different tuple → a different
  // hash), while a RETRY of the same grant reproduces the same id. RewardGranted
  // is a NON-mutating event type, so a null nonce is permitted (the tuple itself
  // supplies the uniqueness; no caller nonce is needed).
  const deriveGrantedEventId = async (
    input: GrantAndCompleteInput,
  ): Promise<EventId> => {
    const preimage = {
      $id: "https://schemas.freeside.thj/reward-granted/v1.0.0",
      preimage_schema_id:
        "https://schemas.freeside.thj/preimage/reward-granted/v1.0.0",
      schema_version: "1.0.0",
      nonce: null,
      originating_event_id: input.event.event_id as unknown as string,
      recipient: input.recipient as unknown as string,
      reward: input.reward,
    } as unknown as Record<string, unknown> & {
      readonly $id: string;
      readonly nonce: string | null;
    };
    const id = await Effect.runPromise(computeEventId(preimage));
    return id as unknown as EventId;
  };
  // Test seam: a caller MAY still inject a synthetic provider (the conformance
  // harness uses this), but production derives deterministically.
  const grantedEventIdProvider = config.nextGrantedEventIdProvider;
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
      // Defect #21.2 fix: pool.connect() runs INSIDE the try. A connect
      // rejection (pool exhaustion / DB unreachable / shutdown race) is the most
      // common transient fault; outside the try it would surface through
      // Effect.promise as an unrecoverable Effect DEFECT, breaking the "NEVER
      // throws — every failure is a sealed AtomicCompletionError" contract.
      // Inside the try it lands in the catch → a retryable
      // RewardAdapterUnavailable. `began` stays false, so the ROLLBACK is
      // correctly skipped (no txn was opened).
      let client: EventStorePostgresClient | undefined;
      let began = false;
      try {
        client = await pool.connect();
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
        //
        // Defect #21.7: granted_event_id is DERIVED deterministically from the
        // grant tuple (process-independent, restart-stable, collision-free),
        // unless a test injected a synthetic provider.
        const grantedEventId =
          grantedEventIdProvider !== undefined
            ? grantedEventIdProvider()
            : await deriveGrantedEventId(input);
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
        //
        // Defect #21.9: metadata now carries the caller's provenance
        // (period_key/step_id) merged with idempotencyKey, matching the legacy
        // path's `{ period_key, step_id }` + the proc's own
        // `v_metadata || { idempotencyKey }`. Previously hard-coded to just
        // { idempotencyKey }, which produced a disjoint metadata shape from
        // legacy rows.
        const procMetadata = {
          ...(input.sourceMetadata ?? {}),
          idempotencyKey: input.resourceIdempotencyKey,
        };
        const { common, rare, legendary } = input.delta;
        if (common !== 0 || rare !== 0 || legendary !== 0) {
          let procRows: ProcDeltaRow[] = [];
          try {
            const procRes = await client.query<ProcDeltaRow>(
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
                JSON.stringify(procMetadata),
                input.resourceIdempotencyKey,
                null,
              ],
            );
            procRows = procRes.rows;
          } catch (mutErr) {
            await client.query("ROLLBACK");
            const code = pgErrorCode(mutErr);
            // 23505 from the prod partial-unique index
            // (user_address, resource_type, idempotency_key) is a DETERMINISTIC
            // idempotency conflict — NOT a transient serialization failure.
            // Defect #21.6: classify it non-retryable (retrying re-hits the same
            // deterministic conflict forever). Surface as a non-retryable
            // ResourceMutationFailed so retry.ts treats it as terminal.
            if (code === PG_UNIQUE_VIOLATION) {
              return ResourceMutationFailed.make({
                reason:
                  "apply_resource_mutation idempotency conflict: a ledger row " +
                  "already exists for (user_address, resource_type, " +
                  "idempotency_key) — deterministic, not retryable",
                retryable: false,
              });
            }
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

          // ── Defect #21.4: enforce the bridge's idempotency invariant ────────
          //
          // The proc returns the ACTUAL deltas it applied (0 if its own
          // idempotency check short-circuited because a ledger row with this
          // idempotency_key already existed). The bridge previously DISCARDED
          // this return value. The danger: the host's legacy resource key is
          // coarse (activity+period+step+user — service.ts:~76), so two distinct
          // event_id completions can share ONE resource key. The 2nd
          // completion's event+grant would COMMIT while the proc no-ops →
          // a durable completed-WITHOUT-reward (the exact failure this bridge
          // exists to prevent).
          //
          // Two layers close this:
          //   1. resourceIdempotencyKey MUST equal event_id (asserted at the
          //      Effect boundary below, before the txn opens), so the resource
          //      key is per-event and the coarse-key collision cannot arise.
          //   2. Belt-and-suspenders HERE: if the proc applied ZERO net delta
          //      while we EXPECTED a non-zero grant, the completion would commit
          //      without the reward — so ROLLBACK and surface a non-retryable
          //      failure instead of silently committing a completed-without-
          //      reward.
          const applied = sumProcDelta(procRows);
          const expected = Math.abs(common) + Math.abs(rare) + Math.abs(legendary);
          if (applied === 0 && expected > 0) {
            await client.query("ROLLBACK");
            return ResourceMutationFailed.make({
              reason:
                "bridge idempotency violation: apply_resource_mutation applied " +
                "ZERO delta for a non-zero reward (a ledger row with this " +
                "idempotency_key already exists for a DIFFERENT completion) — " +
                "refusing to commit a completed-without-reward",
              retryable: false,
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
        if (began && client !== undefined) {
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
        // A connect rejection (client === undefined) lands here too → a sealed
        // retryable RewardAdapterUnavailable, never an Effect defect (#21.2).
        return RewardAdapterUnavailable.make({
          adapter_id: "postgres:atomic-completion",
          reason: `atomic completion failed: ${String(
            txErr instanceof Error ? txErr.message : txErr,
          )}`.slice(0, 512),
        });
      } finally {
        if (client !== undefined) client.release();
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

      // Defect #21.4 layer 1: the resource ledger key MUST be per-event. The
      // host's legacy resource key is coarse (activity+period+step+user), so if
      // the caller threaded a coarse key here, two distinct-event completions
      // could share one resource key — the 2nd proc call no-ops WHILE its
      // event+grant commit → a durable completed-WITHOUT-reward. Pinning the
      // resource key to event_id (the per-completion canonical hash) makes that
      // collision structurally impossible. Rejected BEFORE the txn opens
      // (cheapest rejection first), as a permanent bad-input SchemaValidation.
      if (
        enforceResourceKeyIsEventId &&
        input.resourceIdempotencyKey !== (input.event.event_id as unknown as string)
      ) {
        return yield* Effect.fail(
          SchemaValidation.make({
            event_type: ev.$id,
            detail:
              "resourceIdempotencyKey must equal event_id (defect #21.4): the " +
              "resource ledger key must be per-event so the host's coarse legacy " +
              "key cannot let two distinct completions share one resource key " +
              "(completed-without-reward). " +
              `got resourceIdempotencyKey=${String(input.resourceIdempotencyKey)}, ` +
              `event_id=${String(input.event.event_id)}`,
          }) as AtomicCompletionError,
        );
      }

      const result = yield* Effect.promise(() => run(input));
      if (isObjErr(result) && result._tag !== "RewardGranted") {
        return yield* Effect.fail(result as AtomicCompletionError);
      }
      return result as RewardGrantedRecord;
    }) as Effect.Effect<RewardGrantedRecord, AtomicCompletionError>;

  return { grantAndComplete };
};
