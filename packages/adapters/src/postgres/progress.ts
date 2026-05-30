/**
 * Postgres ProgressPort adapter — Seam-B production backing (T-A1 · Lane A).
 *
 * Mirrors `../in-memory/progress.ts`. The per-(activity, identity) Map becomes
 * the `progress_records` table.
 *
 * CL-Progress-1 (optimistic concurrency): advanceProgress reads + LOCKS the
 * record row (`SELECT … FOR UPDATE`) inside a transaction, compares
 * version_before to the stored version, and only writes if they match. Two
 * racing advances serialize on the row lock — the loser sees the bumped version
 * and fails ConcurrentUpdate. The version column is the durable concurrency
 * token; READ COMMITTED is sufficient here because the FOR UPDATE row lock
 * already serializes the read-modify-write on the SAME row (unlike the
 * event-store's empty-partition case, there is always exactly one row identity
 * per (activity, identity), so there is no phantom to predicate-lock).
 */

import { Effect } from "effect";

import type { ActivityId } from "@0xhoneyjar/quests-protocol";
import {
  type IdentityId,
  type ProgressAdvanced,
  ProgressActivityNotFound,
  ProgressAdapterUnavailable,
  ProgressConcurrentUpdate,
  type ProgressError,
  ProgressIdentityNotFound,
  type ProgressPort,
  type ProgressRecord,
} from "@0xhoneyjar/quests-protocol";

import {
  type EventStorePostgresClient,
  type EventStorePostgresPool,
  type QueryResultRow,
} from "./pool.js";

export interface PostgresProgressPortConfig {
  readonly pool: EventStorePostgresPool;
  readonly knownActivities?: ReadonlySet<ActivityId>;
  readonly knownIdentities?: ReadonlySet<IdentityId>;
  readonly adapterId?: string;
  readonly simulatedFailures?: ReadonlyArray<{
    readonly on: "getProgress" | "advanceProgress" | "any";
    readonly reason: string;
  }>;
  readonly tableName?: string;
}

export interface PostgresProgressPortHandle {
  readonly port: ProgressPort;
}

interface ProgressRow extends QueryResultRow {
  readonly record_json: unknown;
  readonly version: string | number;
}

const toInt = (v: string | number): number =>
  typeof v === "number" ? v : Number.parseInt(v, 10);

export const makePostgresProgressPort = (
  config: PostgresProgressPortConfig,
): PostgresProgressPortHandle => {
  const { pool } = config;
  const table = config.tableName ?? "progress_records";
  const adapterId = config.adapterId ?? "postgres:progress";

  const pendingFailures = [...(config.simulatedFailures ?? [])];
  const consumeSimulatedFailure = (
    op: "getProgress" | "advanceProgress",
  ): string | null => {
    const idx = pendingFailures.findIndex((f) => f.on === op || f.on === "any");
    if (idx === -1) return null;
    const failure = pendingFailures[idx]!;
    pendingFailures.splice(idx, 1);
    return failure.reason;
  };

  const isKnownActivity = (id: ActivityId): boolean =>
    config.knownActivities === undefined || config.knownActivities.has(id);
  const isKnownIdentity = (id: IdentityId): boolean =>
    config.knownIdentities === undefined || config.knownIdentities.has(id);

  const readRecord = async (
    activityId: ActivityId,
    identityId: IdentityId,
  ): Promise<ProgressRow | undefined> => {
    const res = await pool.query<ProgressRow>(
      `SELECT record_json, version FROM ${table}
        WHERE activity_id = $1 AND identity_id = $2 LIMIT 1`,
      [activityId as unknown as string, identityId as unknown as string],
    );
    return res.rows[0];
  };

  // advanceProgress under a FOR UPDATE row lock. Returns either the next
  // ProgressRecord or a ProgressError describing the concurrency conflict.
  const advancePromise = async (
    event: ProgressAdvanced,
  ): Promise<ProgressRecord | ProgressError> => {
    const client: EventStorePostgresClient = await pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query<ProgressRow>(
        `SELECT record_json, version FROM ${table}
          WHERE activity_id = $1 AND identity_id = $2 LIMIT 1 FOR UPDATE`,
        [event.activity_id as unknown as string, event.identity_id as unknown as string],
      );
      const stored = res.rows[0];
      const storedRecord =
        stored === undefined ? undefined : (stored.record_json as ProgressRecord);
      const storedVersion = stored === undefined ? 0 : toInt(stored.version);

      if (event.version_before !== storedVersion) {
        await client.query("ROLLBACK");
        return ProgressConcurrentUpdate.make({
          activity_id: event.activity_id,
          current_version: storedVersion,
          attempted_version: event.version_before,
        });
      }

      const mergedCompletions = storedRecord
        ? [...storedRecord.steps_completed, ...event.new_step_completions]
        : [...event.new_step_completions];
      const last =
        mergedCompletions.length === 0
          ? null
          : mergedCompletions[mergedCompletions.length - 1] ?? null;
      const nextRecord: ProgressRecord = {
        activity_id: event.activity_id,
        identity_id: event.identity_id,
        current_step: last?.step_id ?? null,
        steps_completed: mergedCompletions,
        last_advanced_event_id: event.event_id,
        version: event.version_after,
        lifecycle_state: "IN_PROGRESS",
      };

      await client.query(
        `INSERT INTO ${table} (activity_id, identity_id, record_json, version, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, NOW())
         ON CONFLICT (activity_id, identity_id)
         DO UPDATE SET record_json = EXCLUDED.record_json,
                       version = EXCLUDED.version,
                       updated_at = NOW()`,
        [
          event.activity_id as unknown as string,
          event.identity_id as unknown as string,
          JSON.stringify(nextRecord),
          event.version_after,
        ],
      );
      await client.query("COMMIT");
      return nextRecord;
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* connection may already be aborted */
      }
      return ProgressAdapterUnavailable.make({
        adapter_id: adapterId,
        reason: `postgres advanceProgress failed: ${String(
          e instanceof Error ? e.message : e,
        )}`.slice(0, 512),
      });
    } finally {
      client.release();
    }
  };

  const port: ProgressPort = {
    getProgress: (activityId, identityId) =>
      Effect.gen(function* () {
        const failureReason = consumeSimulatedFailure("getProgress");
        if (failureReason !== null) {
          return yield* Effect.fail(
            ProgressAdapterUnavailable.make({ adapter_id: adapterId, reason: failureReason }),
          );
        }
        if (!isKnownActivity(activityId)) {
          return yield* Effect.fail(
            ProgressActivityNotFound.make({ activity_id: activityId }),
          );
        }
        if (!isKnownIdentity(identityId)) {
          return yield* Effect.fail(
            ProgressIdentityNotFound.make({ identity_id: identityId }),
          );
        }
        const stored = yield* Effect.promise(() => readRecord(activityId, identityId));
        if (stored === undefined) {
          return {
            activity_id: activityId,
            identity_id: identityId,
            current_step: null,
            steps_completed: [],
            last_advanced_event_id: null,
            version: 0,
            lifecycle_state: "NOT_STARTED",
          } satisfies ProgressRecord;
        }
        return stored.record_json as ProgressRecord;
      }) as Effect.Effect<ProgressRecord, ProgressError>,

    advanceProgress: (event: ProgressAdvanced) =>
      Effect.gen(function* () {
        const failureReason = consumeSimulatedFailure("advanceProgress");
        if (failureReason !== null) {
          return yield* Effect.fail(
            ProgressAdapterUnavailable.make({ adapter_id: adapterId, reason: failureReason }),
          );
        }
        if (!isKnownActivity(event.activity_id)) {
          return yield* Effect.fail(
            ProgressActivityNotFound.make({ activity_id: event.activity_id }),
          );
        }
        if (!isKnownIdentity(event.identity_id)) {
          return yield* Effect.fail(
            ProgressIdentityNotFound.make({ identity_id: event.identity_id }),
          );
        }
        const result = yield* Effect.promise(() => advancePromise(event));
        if ("_tag" in result) {
          return yield* Effect.fail(result as ProgressError);
        }
        return result as ProgressRecord;
      }) as Effect.Effect<ProgressRecord, ProgressError>,
  };

  return { port };
};
