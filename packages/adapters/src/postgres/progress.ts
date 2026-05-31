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
  PG_DEADLOCK_DETECTED,
  PG_SERIALIZATION_FAILURE,
  pgErrorCode,
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

  // advanceProgress as a VERSION-GUARDED optimistic-CAS unit-of-work. Returns
  // either the next ProgressRecord or a ProgressError describing the conflict.
  //
  // ── Defect #21.1 (first-advance lost-update) — the fix ──────────────────────
  //
  // The prior impl had a HOLE on the FIRST advance: when no row exists yet,
  // `SELECT … FOR UPDATE` locks NOTHING (FOR UPDATE only locks rows that match;
  // a non-existent row has nothing to lock). Two concurrent first-advances both
  // read storedVersion=0, both pass `version_before(0) == 0`, and the
  // `ON CONFLICT DO UPDATE` had NO version predicate — so the second writer
  // silently CLOBBERED the first, and NEITHER returned ProgressConcurrentUpdate.
  // For reward-granting progress that is a durable lost-update.
  //
  // The fix has two layers (belt-and-suspenders):
  //
  //   1. SERIALIZABLE isolation closes the empty-row PREDICATE race: two writers
  //      that both observe "no row for (activity, identity)" cannot both commit
  //      an INSERT — one is rolled back with SQLSTATE 40001 and retried, at
  //      which point it sees the row the winner inserted.
  //
  //   2. A version-guarded `ON CONFLICT … DO UPDATE … WHERE ${table}.version =
  //      $expected` is the deterministic CAS backstop that does NOT depend on a
  //      retry firing: if a racing writer already advanced the row past the
  //      expected version, the DO UPDATE's WHERE matches zero rows → rowCount 0
  //      → we surface ProgressConcurrentUpdate for the loser. On a genuine first
  //      INSERT (no conflict) rowCount is 1; on a CAS-matching update rowCount
  //      is 1; only the CAS-LOSING update yields 0.
  const advancePromise = async (
    event: ProgressAdvanced,
  ): Promise<ProgressRecord | ProgressError> => {
    let attempt = 0;
    const MAX_RETRIES = 8;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Defect #21.2 fix: connect INSIDE the try so a connect rejection is a
      // sealed AdapterUnavailable, not an Effect defect.
      let client: EventStorePostgresClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
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

        // Version-guarded upsert. The DO UPDATE only fires when the row's
        // CURRENT version still equals the version_before we observed — so a
        // racing writer that already advanced the row loses here (zero rows
        // updated) instead of silently clobbering.
        const upsert = await client.query(
          `INSERT INTO ${table} (activity_id, identity_id, record_json, version, updated_at)
           VALUES ($1, $2, $3::jsonb, $4, NOW())
           ON CONFLICT (activity_id, identity_id)
           DO UPDATE SET record_json = EXCLUDED.record_json,
                         version = EXCLUDED.version,
                         updated_at = NOW()
             WHERE ${table}.version = $5`,
          [
            event.activity_id as unknown as string,
            event.identity_id as unknown as string,
            JSON.stringify(nextRecord),
            event.version_after,
            event.version_before,
          ],
        );

        // rowCount 0 ⇒ the ON CONFLICT DO UPDATE's WHERE didn't match: a racing
        // writer advanced the row past version_before between our SELECT and our
        // upsert (the FOR UPDATE could not lock a row that didn't exist at SELECT
        // time). This is the loser of a first-advance race → ConcurrentUpdate.
        if ((upsert.rowCount ?? 0) === 0) {
          await client.query("ROLLBACK");
          // Re-read the now-current version for an accurate conflict payload.
          const after = await client.query<ProgressRow>(
            `SELECT version FROM ${table}
              WHERE activity_id = $1 AND identity_id = $2 LIMIT 1`,
            [event.activity_id as unknown as string, event.identity_id as unknown as string],
          );
          const currentVersion =
            after.rows[0] === undefined ? storedVersion : toInt(after.rows[0].version);
          return ProgressConcurrentUpdate.make({
            activity_id: event.activity_id,
            current_version: currentVersion,
            attempted_version: event.version_before,
          });
        }

        await client.query("COMMIT");
        return nextRecord;
      } catch (e) {
        if (client !== undefined) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* connection may already be aborted */
          }
        }
        // SERIALIZABLE conflict on the empty-row predicate race (40001) or a
        // deadlock (40P01) → retry the whole CAS; the retry sees the winner's
        // row and fails ConcurrentUpdate deterministically.
        const code = pgErrorCode(e);
        if (
          (code === PG_SERIALIZATION_FAILURE || code === PG_DEADLOCK_DETECTED) &&
          attempt < MAX_RETRIES
        ) {
          attempt += 1;
          continue;
        }
        return ProgressAdapterUnavailable.make({
          adapter_id: adapterId,
          reason: `postgres advanceProgress failed: ${String(
            e instanceof Error ? e.message : e,
          )}`.slice(0, 512),
        });
      } finally {
        if (client !== undefined) client.release();
      }
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
