/**
 * Postgres RewardPort adapter — Seam-B production backing (T-A1 · Lane A).
 *
 * Mirrors `../in-memory/reward.ts`. The ONLY structural difference: the grant
 * store + recipient index live in the `reward_grants` table instead of two
 * Maps.
 *
 * CL-Reward-2 (D18 idempotency): the (originating_event_id, recipient) tuple is
 * the table PRIMARY KEY. The happy-path INSERT either succeeds OR raises a
 * unique-violation (23505); on 23505 the adapter re-reads the existing row and
 * surfaces AlreadyGranted carrying the EXISTING granted_event_id — so the race
 * between two concurrent grants for the same tuple is resolved by the DB, not
 * by a check-then-insert window.
 *
 * The simulated-failure / failing-grant / unresolvable-identity hooks are kept
 * (the conformance suite drives every RewardError variant through them) — they
 * are process-local injectors, exactly as in-memory, and do NOT touch the DB.
 */

import { Effect, Schema } from "effect";

import {
  ActivityReward,
  type EventId,
  type IdentityId,
  RewardAdapterUnavailable,
  RewardAlreadyGranted,
  type RewardError,
  type RewardGranted,
  RewardGrantFailed,
  RewardIdentityUnresolvable,
  type RewardPort,
} from "@0xhoneyjar/quests-protocol";

import {
  type EventStorePostgresPool,
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
  type QueryResultRow,
} from "./pool.js";

type RewardGrantedRecord = Schema.Schema.Type<typeof RewardGranted>;

// ActivityReward is the sealed reward-intent union. Stored reward intents are
// round-tripped through it on read so the JSONB ⇄ object conversion preserves
// the tagged shape (e.g. ActivityRewardNone).
const decodeReward = Schema.decodeUnknownSync(ActivityReward);

export interface PostgresRewardPortConfig {
  readonly pool: EventStorePostgresPool;
  /** Identities the resolver cannot bind → IdentityUnresolvable. */
  readonly unresolvableIdentities?: ReadonlySet<IdentityId>;
  /** One-shot grant failures → GrantFailed. */
  readonly failingGrants?: ReadonlyArray<{
    readonly recipient: IdentityId;
    readonly reason: string;
    readonly retryable: boolean;
  }>;
  /** Opaque label surfaced in AdapterUnavailable. Default "postgres:reward". */
  readonly adapterId?: string;
  /** One-shot AdapterUnavailable injectors. */
  readonly simulatedFailures?: ReadonlyArray<{
    readonly on: "grant" | "query" | "any";
    readonly reason: string;
  }>;
  /** Synthetic granted_event_id provider. Default deterministic counter. */
  readonly nextGrantedEventIdProvider?: () => EventId;
  readonly timestampProvider?: () => string;
  readonly tableName?: string;
}

export interface PostgresRewardPortHandle {
  readonly port: RewardPort;
}

interface RewardRow extends QueryResultRow {
  readonly originating_event_id: string;
  readonly granted_event_id: string;
  readonly reward: unknown;
  readonly ts: string;
}

const idempotencyKeyToTuple = (
  originatingEventId: EventId,
  recipient: IdentityId,
): [string, string] => [
  originatingEventId as unknown as string,
  recipient as unknown as string,
];

export const makePostgresRewardPort = (
  config: PostgresRewardPortConfig,
): PostgresRewardPortHandle => {
  const { pool } = config;
  const table = config.tableName ?? "reward_grants";
  const adapterId = config.adapterId ?? "postgres:reward";

  const pendingFailures = [...(config.simulatedFailures ?? [])];
  const pendingFailingGrants = [...(config.failingGrants ?? [])];

  const consumeSimulatedFailure = (op: "grant" | "query"): string | null => {
    const idx = pendingFailures.findIndex((f) => f.on === op || f.on === "any");
    if (idx === -1) return null;
    const failure = pendingFailures[idx]!;
    pendingFailures.splice(idx, 1);
    return failure.reason;
  };

  const consumeFailingGrant = (
    recipient: IdentityId,
  ): { reason: string; retryable: boolean } | null => {
    const idx = pendingFailingGrants.findIndex(
      (f) => (f.recipient as unknown as string) === (recipient as unknown as string),
    );
    if (idx === -1) return null;
    const failure = pendingFailingGrants[idx]!;
    pendingFailingGrants.splice(idx, 1);
    return { reason: failure.reason, retryable: failure.retryable };
  };

  let counter = 0;
  const defaultGrantedEventId = (): EventId => {
    counter += 1;
    return counter.toString(16).padStart(64, "f") as unknown as EventId;
  };
  const grantedEventIdProvider =
    config.nextGrantedEventIdProvider ?? defaultGrantedEventId;
  const timestampProvider =
    config.timestampProvider ?? (() => "2026-05-16T00:00:00Z");

  const readExisting = async (
    originatingEventId: EventId,
    recipient: IdentityId,
  ): Promise<RewardGrantedRecord | null> => {
    const [origin, recip] = idempotencyKeyToTuple(originatingEventId, recipient);
    const res = await pool.query<RewardRow>(
      `SELECT originating_event_id, granted_event_id, reward, ts
         FROM ${table}
        WHERE originating_event_id = $1 AND recipient = $2
        LIMIT 1`,
      [origin, recip],
    );
    const row = res.rows[0];
    if (row === undefined) return null;
    return {
      _tag: "RewardGranted",
      reward: decodeReward(row.reward),
      originating_event_id: row.originating_event_id as unknown as EventId,
      granted_event_id: row.granted_event_id as unknown as EventId,
      ts: row.ts as RewardGrantedRecord["ts"],
    };
  };

  const port: RewardPort = {
    grant: (reward: ActivityReward, recipient: IdentityId, originatingEventId: EventId) =>
      Effect.gen(function* () {
        const failureReason = consumeSimulatedFailure("grant");
        if (failureReason !== null) {
          return yield* Effect.fail(
            RewardAdapterUnavailable.make({ adapter_id: adapterId, reason: failureReason }),
          );
        }

        // CL-Reward-2 (D18): idempotency hit BEFORE we attempt other failures —
        // matches the in-memory ordering (existing-tuple short-circuits).
        const existing = yield* Effect.promise(() =>
          readExisting(originatingEventId, recipient),
        );
        if (existing !== null) {
          return yield* Effect.fail(
            RewardAlreadyGranted.make({
              originating_event_id: originatingEventId,
              existing_grant_id: existing.granted_event_id,
            }),
          );
        }

        if (
          config.unresolvableIdentities !== undefined &&
          config.unresolvableIdentities.has(recipient)
        ) {
          return yield* Effect.fail(
            RewardIdentityUnresolvable.make({ identity_id: recipient }),
          );
        }

        const failingGrant = consumeFailingGrant(recipient);
        if (failingGrant !== null) {
          return yield* Effect.fail(
            RewardGrantFailed.make({
              reward_intent: reward,
              reason: failingGrant.reason,
              retryable: failingGrant.retryable,
            }),
          );
        }

        const grantedEventId = grantedEventIdProvider();
        const ts = timestampProvider();
        const [origin, recip] = idempotencyKeyToTuple(originatingEventId, recipient);
        const insert = yield* Effect.promise(() =>
          pool
            .query(
              `INSERT INTO ${table}
                 (originating_event_id, recipient, granted_event_id, reward, ts)
               VALUES ($1, $2, $3, $4::jsonb, $5)`,
              [
                origin,
                recip,
                grantedEventId as unknown as string,
                JSON.stringify(reward),
                ts,
              ],
            )
            .then(() => ({ ok: true as const }))
            .catch((e: unknown) => ({ ok: false as const, error: e })),
        );

        if (!insert.ok) {
          // Concurrent grant for the same tuple won the race → AlreadyGranted.
          if (pgErrorCode(insert.error) === PG_UNIQUE_VIOLATION) {
            const now = yield* Effect.promise(() =>
              readExisting(originatingEventId, recipient),
            );
            if (now !== null) {
              return yield* Effect.fail(
                RewardAlreadyGranted.make({
                  originating_event_id: originatingEventId,
                  existing_grant_id: now.granted_event_id,
                }),
              );
            }
          }
          return yield* Effect.fail(
            RewardAdapterUnavailable.make({
              adapter_id: adapterId,
              reason: `postgres grant insert failed: ${String(
                insert.error instanceof Error ? insert.error.message : insert.error,
              )}`.slice(0, 512),
            }),
          );
        }

        return {
          _tag: "RewardGranted",
          reward,
          originating_event_id: originatingEventId,
          granted_event_id: grantedEventId,
          ts: ts as RewardGrantedRecord["ts"],
        } satisfies RewardGrantedRecord;
      }) as Effect.Effect<RewardGrantedRecord, RewardError>,

    query: (identity: IdentityId) =>
      Effect.gen(function* () {
        const failureReason = consumeSimulatedFailure("query");
        if (failureReason !== null) {
          return yield* Effect.fail(
            RewardAdapterUnavailable.make({ adapter_id: adapterId, reason: failureReason }),
          );
        }
        const res = yield* Effect.promise(() =>
          pool.query<RewardRow>(
            `SELECT originating_event_id, granted_event_id, reward, ts
               FROM ${table}
              WHERE recipient = $1
              ORDER BY inserted_at ASC`,
            [identity as unknown as string],
          ),
        );
        return res.rows.map(
          (row): RewardGrantedRecord => ({
            _tag: "RewardGranted",
            reward: decodeReward(row.reward),
            originating_event_id: row.originating_event_id as unknown as EventId,
            granted_event_id: row.granted_event_id as unknown as EventId,
            ts: row.ts as RewardGrantedRecord["ts"],
          }),
        ) as ReadonlyArray<RewardGrantedRecord>;
      }) as Effect.Effect<ReadonlyArray<RewardGrantedRecord>, RewardError>,
  };

  return { port };
};
