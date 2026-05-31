/**
 * Postgres ProgressPort CONCURRENCY proof — the defect #21.1 race test (Lane A).
 *
 * The shared conformance suite exercises optimistic-CAS SERIALLY (advance, then
 * a stale advance). That proves the CAS *check* but NOT the FIRST-ADVANCE race —
 * the exact hole defect #21.1 found: when no row exists yet, `SELECT … FOR
 * UPDATE` locks NOTHING, so two concurrent first-advances both read version 0,
 * both pass `version_before(0) == 0`, and the unguarded `ON CONFLICT DO UPDATE`
 * let the second SILENTLY CLOBBER the first — neither returning
 * ProgressConcurrentUpdate. For reward-granting progress that is a durable
 * lost-update.
 *
 * This file fires N genuinely-parallel FIRST advances (all version_before=0)
 * against the SAME never-touched (activity, identity) and asserts EXACTLY ONE
 * wins. It also fires N parallel advances from a SAME REAL version to prove the
 * non-empty-row race. Both are the real proof that SERIALIZABLE + the
 * version-guarded upsert hold. pg-mem proves nothing (no SERIALIZABLE / FOR
 * UPDATE), so this runs against the disposable real-Postgres harness.
 *
 * ADDITIVE: it does not touch the conformance suite.
 */
import { Effect, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ActivityId,
  EventId,
  IdentityId,
  type ProgressAdvanced,
  RFC3339Date,
  StepId,
} from "@0xhoneyjar/quests-protocol";

import { makePostgresProgressPort } from "../progress.js";
import { startTestPostgres, type TestPostgres } from "./test-pg.js";

const decode = Schema.decodeUnknownSync;

let harness: TestPostgres | null = null;

beforeAll(async () => {
  harness = await startTestPostgres();
}, 120_000);

afterAll(async () => {
  if (harness !== null) await harness.stop();
});

const activity = decode(ActivityId)("act_prograce");
const identity = decode(IdentityId)("id_prograce");
const stepFoo = decode(StepId)("step_foo");
const ts0 = decode(RFC3339Date)("2026-05-16T00:00:00Z");

const advanceEvent = (overrides: {
  versionBefore: number;
  versionAfter: number;
  eventIdHex: string;
}): ProgressAdvanced =>
  ({
    event_id: decode(EventId)(overrides.eventIdHex),
    preimage_schema_id:
      "https://schemas.freeside.thj/preimage/progress-advanced/v1.0.0",
    ts: ts0,
    source_event_hash: null,
    nonce: `nonce-${overrides.eventIdHex.slice(0, 8)}`,
    schema_version: "1.0.0",
    $id: "https://schemas.freeside.thj/progress-advanced/v1.0.0",
    activity_id: activity,
    identity_id: identity,
    new_step_completions: [
      {
        step_id: stepFoo,
        order: 0,
        completed_at: ts0,
        event_id: decode(EventId)(overrides.eventIdHex),
      },
    ],
    version_before: overrides.versionBefore,
    version_after: overrides.versionAfter,
  }) as unknown as ProgressAdvanced;

const hexFor = (i: number): string => i.toString(16).padStart(64, "a");

const itPg = process.env.LOA_PG_CONFORMANCE_SKIP === "1" ? it.skip : it;

describe("ProgressPort — optimistic-CAS under genuine concurrency (postgres)", () => {
  itPg(
    "FIRST-advance race: N parallel version_before=0 advances → exactly 1 wins (defect #21.1)",
    async () => {
      if (harness === null) throw new Error("docker harness unavailable");
      const { port } = makePostgresProgressPort({ pool: harness.freshPool() });

      const N = 8;
      const events = Array.from({ length: N }, (_, i) =>
        advanceEvent({ versionBefore: 0, versionAfter: 1, eventIdHex: hexFor(i + 1) }),
      );

      // All N start from the SAME never-touched (activity, identity), all
      // claiming version_before=0. WITHOUT the version-guard + SERIALIZABLE this
      // admits the lost-update: multiple writers see "no row" and all upsert,
      // the last silently clobbering. WITH the fix: exactly 1 commits, the rest
      // fail ConcurrentUpdate.
      const results = await Promise.all(
        events.map((e) => Effect.runPromise(Effect.either(port.advanceProgress(e)))),
      );

      const winners = results.filter((r) => r._tag === "Right");
      const losers = results.filter((r) => r._tag === "Left");

      expect(winners.length).toBe(1);
      expect(losers.length).toBe(N - 1);
      // Every loser is a CLEAN ConcurrentUpdate (NOT an infra error / not a
      // silent success / not a clobber).
      for (const l of losers) {
        if (l._tag === "Left") expect(l.left._tag).toBe("ConcurrentUpdate");
      }

      // The store has the winner's record at version 1 — no lost-update.
      const final = await Effect.runPromise(port.getProgress(activity, identity));
      expect(final.version).toBe(1);
      expect(final.lifecycle_state).toBe("IN_PROGRESS");
      expect(final.steps_completed).toHaveLength(1);
    },
    60_000,
  );

  itPg(
    "DETERMINISTIC interleave: two first-advances both observe an empty row, only one commits (defect #21.1)",
    async () => {
      // This is the deterministic teeth for defect #21.1. We manually drive the
      // EXACT interleaving the port's SERIALIZABLE retry + version-guard must
      // survive: two clients BOTH read "no row", BOTH believe version_before=0,
      // then BOTH try to upsert. Under the ORIGINAL bug (READ COMMITTED +
      // unguarded DO UPDATE) the second would clobber the first → version stays
      // 1 but the winner's row is overwritten (a lost-update masquerading as
      // success). Under the fix, the second's version-guarded DO UPDATE matches
      // ZERO rows (the row's version is already 1) → it CANNOT clobber.
      if (harness === null) throw new Error("docker harness unavailable");
      const pool = harness.freshPool();

      const a = await pool.connect();
      const b = await pool.connect();
      try {
        const table = "progress_records";
        const aid = "act_interleave";
        const iid = "id_interleave";

        // Both txns open and BOTH see the empty row (the FOR UPDATE locks
        // nothing — the exact hole defect #21.1 found).
        await a.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        await b.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        const aSel = await a.query(
          `SELECT version FROM ${table} WHERE activity_id=$1 AND identity_id=$2 FOR UPDATE`,
          [aid, iid],
        );
        const bSel = await b.query(
          `SELECT version FROM ${table} WHERE activity_id=$1 AND identity_id=$2 FOR UPDATE`,
          [aid, iid],
        );
        expect(aSel.rows.length).toBe(0); // both see no row
        expect(bSel.rows.length).toBe(0);

        // A wins the first INSERT (version 0 → 1) and commits.
        const aUpsert = await a.query(
          `INSERT INTO ${table} (activity_id, identity_id, record_json, version, updated_at)
           VALUES ($1,$2,$3::jsonb,$4,NOW())
           ON CONFLICT (activity_id, identity_id)
           DO UPDATE SET record_json=EXCLUDED.record_json, version=EXCLUDED.version, updated_at=NOW()
             WHERE ${table}.version = $5`,
          [aid, iid, JSON.stringify({ winner: "a" }), 1, 0],
        );
        expect(aUpsert.rowCount).toBe(1);
        await a.query("COMMIT");

        // B now tries the SAME version-guarded upsert believing version_before=0.
        // It conflicts on the PK, the DO UPDATE's WHERE checks version=0, but the
        // row is now version 1 → ZERO rows updated → B is the CAS loser. The
        // version-guard is the mechanism that makes this impossible to clobber.
        const bUpsert = await b.query(
          `INSERT INTO ${table} (activity_id, identity_id, record_json, version, updated_at)
           VALUES ($1,$2,$3::jsonb,$4,NOW())
           ON CONFLICT (activity_id, identity_id)
           DO UPDATE SET record_json=EXCLUDED.record_json, version=EXCLUDED.version, updated_at=NOW()
             WHERE ${table}.version = $5`,
          [aid, iid, JSON.stringify({ winner: "b-CLOBBER" }), 1, 0],
        );
        expect(bUpsert.rowCount).toBe(0); // ← the guard refused B's clobber
        await b.query("ROLLBACK");

        // The committed row is A's — B did NOT clobber.
        const final = await pool.query<{ record_json: { winner: string } }>(
          `SELECT record_json FROM ${table} WHERE activity_id=$1 AND identity_id=$2`,
          [aid, iid],
        );
        expect(final.rows[0]?.record_json.winner).toBe("a");
      } finally {
        a.release();
        b.release();
      }
    },
    60_000,
  );

  itPg(
    "non-empty-row race: N parallel advances from the same real version → exactly 1 wins",
    async () => {
      if (harness === null) throw new Error("docker harness unavailable");
      const { port } = makePostgresProgressPort({ pool: harness.freshPool() });

      // Seed version 1 so the row exists; racers all claim version_before=1.
      await Effect.runPromise(
        port.advanceProgress(
          advanceEvent({ versionBefore: 0, versionAfter: 1, eventIdHex: hexFor(100) }),
        ),
      );

      const N = 8;
      const racers = Array.from({ length: N }, (_, i) =>
        advanceEvent({ versionBefore: 1, versionAfter: 2, eventIdHex: hexFor(200 + i) }),
      );
      const results = await Promise.all(
        racers.map((e) => Effect.runPromise(Effect.either(port.advanceProgress(e)))),
      );

      const winners = results.filter((r) => r._tag === "Right");
      expect(winners.length).toBe(1);
      for (const r of results) {
        if (r._tag === "Left") expect(r.left._tag).toBe("ConcurrentUpdate");
      }

      const final = await Effect.runPromise(port.getProgress(activity, identity));
      expect(final.version).toBe(2);
    },
    60_000,
  );
});
