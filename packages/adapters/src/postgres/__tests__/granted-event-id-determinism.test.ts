/**
 * granted_event_id determinism + fail-closed proof (defect #21.7).
 *
 * The prior impl minted granted_event_id from a per-PROCESS hex counter that
 * reset on restart and ran independently per worker — so two workers (or one
 * across a redeploy) could mint the SAME synthetic id for DIFFERENT grants.
 * Because granted_event_id had no UNIQUE constraint, that collision was silent
 * and corrupted retry.ts's D18 AlreadyGranted recovery (`.find(g =>
 * g.granted_event_id === existing_grant_id)`), returning the WRONG record.
 *
 * Proven here:
 *   1. DETERMINISM: two completer instances (modeling two processes / a
 *      redeploy) granting the SAME completion produce the SAME granted_event_id
 *      (it is derived via computeEventId, not a counter). And DISTINCT grants
 *      produce DISTINCT ids.
 *   2. FAIL-CLOSED: the reward_grants.granted_event_id UNIQUE constraint turns a
 *      residual collision into a hard 23505 instead of a silent overwrite.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ActivityCompleted,
  ActivityId,
  ActivityRewardResource,
  computeEventIdSync,
  type EventId,
  IdentityId,
  type PartitionKey,
  type PartitionScope,
  RFC3339Date,
} from "@0xhoneyjar/quests-protocol";

import {
  makePostgresAtomicCompletion,
  type GrantAndCompleteInput,
} from "../atomic-completion.js";
import type { EventStorePostgresPool } from "../pool.js";
import { startTestPostgres, type TestPostgres } from "./test-pg.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESOURCE_FIXTURE = readFileSync(
  resolve(__dirname, "./apply-resource-mutation-fixture.sql"),
  "utf8",
);

const decode = Schema.decodeUnknownSync;

let harness: TestPostgres | null = null;
beforeAll(async () => {
  harness = await startTestPostgres();
}, 120_000);
afterAll(async () => {
  if (harness !== null) await harness.stop();
});

const activity = decode(ActivityId)("act_grantid");
const identityA = decode(IdentityId)("id_grantida");
const identityB = decode(IdentityId)("id_grantidb");
const userAddress = "0xfeedface00000000000000000000000000000000";

const partition: PartitionKey = {
  scope: "activity" as PartitionScope,
  value: activity as unknown as string,
} as PartitionKey;

const buildCompletion = async (
  nonce: string,
  identity: typeof identityA,
): Promise<ActivityCompleted> => {
  const draft = {
    event_id: "0".repeat(64),
    preimage_schema_id:
      "https://schemas.freeside.thj/preimage/activity-completed/v1.0.0",
    ts: decode(RFC3339Date)("2026-05-16T00:00:00Z"),
    source_event_hash: null,
    nonce,
    schema_version: "1.0.0" as const,
    $id: "https://schemas.freeside.thj/activity-completed/v1.0.0" as const,
    activity_id: activity,
    identity_id: identity,
    period_key: null,
    step_completions: [],
    reward_state_id: null,
  };
  const computed = await computeEventIdSync(
    draft as unknown as Record<string, unknown> & { $id: string; nonce: string | null },
  );
  return decode(ActivityCompleted)({ ...draft, event_id: computed });
};

const reward = ActivityRewardResource.make({ resource_kind: "core", amount: 10 });

const inputFor = (
  event: ActivityCompleted,
  recipient: typeof identityA,
  expectedTip: EventId | null,
): GrantAndCompleteInput => ({
  event: event as unknown as GrantAndCompleteInput["event"],
  partition_key: partition,
  expected_tip_hash: expectedTip,
  reward,
  recipient,
  userAddress,
  delta: { common: 10, rare: 0, legendary: 0 },
  resourceIdempotencyKey: event.event_id as unknown as string,
  sourceType: "activity_completion",
  sourceId: activity as unknown as string,
});

const itPg = process.env.LOA_PG_CONFORMANCE_SKIP === "1" ? it.skip : it;

describe("granted_event_id — deterministic + fail-closed (defect #21.7)", () => {
  itPg(
    "DETERMINISTIC: same completion across two completer instances → SAME granted_event_id",
    async () => {
      if (harness === null) throw new Error("docker harness unavailable");

      // Two SEPARATE schemas (two independent stores), modeling two processes /
      // a redeploy. The granted_event_id must be IDENTICAL because it derives
      // from the grant tuple, not a per-process counter.
      const poolA = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });
      const poolB = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });
      const completerA = makePostgresAtomicCompletion({ pool: poolA });
      const completerB = makePostgresAtomicCompletion({ pool: poolB });

      const event = await buildCompletion("determinism", identityA);
      const rA = await Effect.runPromise(
        completerA.grantAndComplete(inputFor(event, identityA, null)),
      );
      const rB = await Effect.runPromise(
        completerB.grantAndComplete(inputFor(event, identityA, null)),
      );
      expect(rA._tag).toBe("RewardGranted");
      expect(rB._tag).toBe("RewardGranted");
      // The decisive assertion: process-independent, restart-stable id.
      expect(rA.granted_event_id).toBe(rB.granted_event_id);
      // And it is a 64-hex digest, not a counter like "ee…e1".
      expect(String(rA.granted_event_id)).toMatch(/^[a-f0-9]{64}$/);
    },
    60_000,
  );

  itPg(
    "DISTINCT grants (different recipient) → DISTINCT granted_event_id",
    async () => {
      if (harness === null) throw new Error("docker harness unavailable");
      const pool = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });
      const completer = makePostgresAtomicCompletion({ pool });

      const eventA = await buildCompletion("recipientA", identityA);
      const eventB = await buildCompletion("recipientB", identityB);
      const rA = await Effect.runPromise(
        completer.grantAndComplete(inputFor(eventA, identityA, null)),
      );
      const rB = await Effect.runPromise(
        completer.grantAndComplete(
          inputFor(eventB, identityB, eventA.event_id as unknown as EventId),
        ),
      );
      expect(rA.granted_event_id).not.toBe(rB.granted_event_id);
    },
    60_000,
  );

  itPg(
    "FAIL-CLOSED: reward_grants.granted_event_id has a UNIQUE constraint (residual collision → 23505)",
    async () => {
      if (harness === null) throw new Error("docker harness unavailable");
      const pool = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });

      // Assert the UNIQUE constraint exists in the per-factory schema (the
      // fail-closed backstop). pg_constraint isn't search_path-filtered, so we
      // scope to current_schema() via the constraint's namespace.
      const con = await pool.query<{ conname: string }>(
        `SELECT c.conname FROM pg_constraint c
           JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE c.conname = 'reward_grants_granted_event_id_uniq'
            AND n.nspname = current_schema()`,
      );
      expect(con.rows.length).toBe(1);

      // And it actually fails closed: inserting two reward_grants rows with the
      // SAME granted_event_id but DIFFERENT originating tuples raises 23505
      // instead of silently coexisting (which would let retry.ts's .find return
      // the wrong record).
      await pool.query(
        `INSERT INTO reward_grants (originating_event_id, recipient, granted_event_id, reward, ts)
         VALUES ($1,$2,$3,$4::jsonb,$5)`,
        ["a".repeat(64), "id_a", "c".repeat(64), JSON.stringify({ _tag: "ActivityRewardNone" }), "2026-05-16T00:00:00Z"],
      );
      let raised = false;
      try {
        await pool.query(
          `INSERT INTO reward_grants (originating_event_id, recipient, granted_event_id, reward, ts)
           VALUES ($1,$2,$3,$4::jsonb,$5)`,
          ["b".repeat(64), "id_b", "c".repeat(64), JSON.stringify({ _tag: "ActivityRewardNone" }), "2026-05-16T00:00:00Z"],
        );
      } catch (e) {
        raised = (e as { code?: string }).code === "23505";
      }
      expect(raised).toBe(true);
    },
    60_000,
  );
});
