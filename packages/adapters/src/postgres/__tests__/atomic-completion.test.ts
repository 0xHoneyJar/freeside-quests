/**
 * Postgres ATOMICITY proof — the T-A2 crash-injection suite (Lane A · SDD §12.1).
 *
 * This is the single highest-risk correctness claim of the cycle: the engine's
 * append→grant decomposition MUST preserve the legacy stored proc's
 * single-transaction atomicity. {CAS event-append → reward_grants write →
 * apply_resource_mutation} run on ONE pg client inside ONE BEGIN…COMMIT.
 *
 * What this suite PROVES (not claims):
 *
 *  1. HAPPY PATH — a completion appends the event, records the grant, AND
 *     mutates the ledger; after COMMIT all three are durable and consistent.
 *
 *  2. CRASH AFTER APPEND → BOTH ROLL BACK — a fault injected AFTER the event
 *     append but BEFORE commit leaves NO event row AND NO ledger mutation.
 *     This is the failure the naïve append-then-grant decomposition could not
 *     survive (it would commit the event, then crash before the grant).
 *
 *  3. CRASH DURING/AFTER RESOURCE MUTATION → ROLL BACK — a fault injected after
 *     apply_resource_mutation ran (but before commit) rolls back the ledger
 *     mutation too. Proves the proc runs IN our transaction, not its own.
 *
 *  4. RETRY OF THE SAME COMPLETION → EXACTLY ONE GRANT — replaying the same
 *     completion (same event_id) after a successful first grant is a clean
 *     no-op: the event_id duplicate-reject fires, the txn rolls back, and the
 *     balance is NOT mutated a second time. No double-grant.
 *
 *  5. RETRY AFTER A CRASH → EXACTLY ONE GRANT — the crash left no event, so the
 *     retry succeeds for the first time and applies the reward exactly once.
 *
 * Runs against the disposable real-Postgres harness (pg-mem proves nothing for
 * transaction rollback). The apply_resource_mutation fixture mirrors the real
 * cubquest-db proc signature (see apply-resource-mutation-fixture.sql).
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

const activity = decode(ActivityId)("act_atomic");
const identity = decode(IdentityId)("id_atomic");
const userAddress = "0xfeedface00000000000000000000000000000000";

const partition: PartitionKey = {
  scope: "activity" as PartitionScope,
  value: activity as unknown as string,
} as PartitionKey;

const buildCompletion = async (nonce: string) => {
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
    draft as unknown as Record<string, unknown> & {
      $id: string;
      nonce: string | null;
    },
  );
  return decode(ActivityCompleted)({ ...draft, event_id: computed });
};

const reward = ActivityRewardResource.make({ resource_kind: "core", amount: 10 });

const inputFor = (
  event: ActivityCompleted,
  overrides: Partial<GrantAndCompleteInput> = {},
): GrantAndCompleteInput => ({
  event: event as unknown as GrantAndCompleteInput["event"],
  partition_key: partition,
  expected_tip_hash: null,
  reward,
  recipient: identity,
  userAddress,
  delta: { common: 10, rare: 0, legendary: 0 },
  resourceIdempotencyKey: event.event_id as unknown as string,
  sourceType: "activity_completion",
  sourceId: activity as unknown as string,
  ...overrides,
});

// Schema-qualified counters used to assert "nothing persisted".
const countEvents = async (pool: EventStorePostgresPool): Promise<number> => {
  const r = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM event_store WHERE scope = $1 AND partition_value = $2`,
    [partition.scope, partition.value],
  );
  return Number.parseInt(r.rows[0]?.n ?? "0", 10);
};
const countGrants = async (pool: EventStorePostgresPool): Promise<number> => {
  const r = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM reward_grants WHERE recipient = $1`,
    [identity as unknown as string],
  );
  return Number.parseInt(r.rows[0]?.n ?? "0", 10);
};
const balanceOf = async (pool: EventStorePostgresPool): Promise<number> => {
  const r = await pool.query<{ common: number }>(
    `SELECT common FROM user_resources WHERE user_address = $1`,
    [userAddress.toLowerCase()],
  );
  return r.rows[0]?.common ?? 0;
};
const countLedgerTx = async (pool: EventStorePostgresPool): Promise<number> => {
  const r = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM resource_transactions WHERE user_address = $1`,
    [userAddress.toLowerCase()],
  );
  return Number.parseInt(r.rows[0]?.n ?? "0", 10);
};

const itPg = process.env.LOA_PG_CONFORMANCE_SKIP === "1" ? it.skip : it;

describe("Atomicity bridge — append+grant+resource-mutation in ONE txn (postgres)", () => {
  itPg(
    "happy path: event + grant + ledger mutation all commit together",
    async () => {
      if (harness === null) throw new Error("docker harness unavailable");
      const pool = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });
      const { grantAndComplete } = makePostgresAtomicCompletion({ pool });

      const event = await buildCompletion("happy");
      const result = await Effect.runPromise(grantAndComplete(inputFor(event)));

      expect(result._tag).toBe("RewardGranted");
      expect(result.originating_event_id).toBe(event.event_id);
      expect(await countEvents(pool)).toBe(1);
      expect(await countGrants(pool)).toBe(1);
      expect(await balanceOf(pool)).toBe(10);
      expect(await countLedgerTx(pool)).toBe(1);
    },
    60_000,
  );

  itPg(
    "CRASH after append, before grant → BOTH roll back (no event, no balance)",
    async () => {
      if (harness === null) throw new Error("docker harness unavailable");
      const pool = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });
      const { grantAndComplete } = makePostgresAtomicCompletion({
        pool,
        __crashAfter: (seam) => {
          if (seam === "append") throw new Error("injected crash after append");
        },
      });

      const event = await buildCompletion("crash_append");
      const outcome = await Effect.runPromise(
        Effect.either(grantAndComplete(inputFor(event))),
      );

      // The unit-of-work surfaces the crash as an AdapterUnavailable error…
      expect(outcome._tag).toBe("Left");
      // …and CRITICALLY nothing persisted: the event append was rolled back
      // along with everything downstream.
      expect(await countEvents(pool)).toBe(0);
      expect(await countGrants(pool)).toBe(0);
      expect(await balanceOf(pool)).toBe(0);
      expect(await countLedgerTx(pool)).toBe(0);
    },
    60_000,
  );

  itPg(
    "CRASH after resource-mutation, before commit → ledger mutation rolls back",
    async () => {
      if (harness === null) throw new Error("docker harness unavailable");
      const pool = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });
      const { grantAndComplete } = makePostgresAtomicCompletion({
        pool,
        __crashAfter: (seam) => {
          // The proc has ALREADY run (FOR UPDATE + UPDATE user_resources +
          // INSERT resource_transactions). If it ran in its OWN txn this would
          // leak a committed balance; because it runs in OURS, the rollback
          // un-does it.
          if (seam === "resource-mutation") {
            throw new Error("injected crash after resource mutation");
          }
        },
      });

      const event = await buildCompletion("crash_after_mut");
      const outcome = await Effect.runPromise(
        Effect.either(grantAndComplete(inputFor(event))),
      );

      expect(outcome._tag).toBe("Left");
      expect(await countEvents(pool)).toBe(0);
      expect(await countGrants(pool)).toBe(0);
      expect(await balanceOf(pool)).toBe(0);
      expect(await countLedgerTx(pool)).toBe(0);
    },
    60_000,
  );

  itPg(
    "retry of the SAME completion (same event_id) → exactly ONE grant, ONE mutation",
    async () => {
      if (harness === null) throw new Error("docker harness unavailable");
      const pool = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });
      const { grantAndComplete } = makePostgresAtomicCompletion({ pool });

      const event = await buildCompletion("retry_same");

      // First grant succeeds.
      const first = await Effect.runPromise(grantAndComplete(inputFor(event)));
      expect(first._tag).toBe("RewardGranted");

      // Retry: identical event (same canonical event_id). The expected_tip_hash
      // is now stale (the partition advanced), but the event_id duplicate-reject
      // is the decisive guard — the whole txn rolls back, balance untouched.
      const retry = await Effect.runPromise(
        Effect.either(
          grantAndComplete(
            inputFor(event, { expected_tip_hash: event.event_id }),
          ),
        ),
      );
      expect(retry._tag).toBe("Left");
      if (retry._tag === "Left") {
        // DuplicateEvent (event_id PK) or CASFailed (stale tip) — either way it
        // is rejected BEFORE any second mutation. Both are acceptable rejects;
        // what matters is exactly-once below.
        expect(["DuplicateEvent", "CASFailed"]).toContain(retry.left._tag);
      }

      expect(await countEvents(pool)).toBe(1);
      expect(await countGrants(pool)).toBe(1);
      expect(await balanceOf(pool)).toBe(10); // NOT 20 — no double-grant
      expect(await countLedgerTx(pool)).toBe(1);
    },
    60_000,
  );

  itPg(
    "retry AFTER a crash → first durable grant applies exactly once",
    async () => {
      if (harness === null) throw new Error("docker harness unavailable");
      const pool = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });

      const event = await buildCompletion("retry_after_crash");

      // Attempt 1 crashes after append → rolls back entirely.
      const crashing = makePostgresAtomicCompletion({
        pool,
        __crashAfter: (seam) => {
          if (seam === "append") throw new Error("crash before grant");
        },
      });
      const crashed = await Effect.runPromise(
        Effect.either(crashing.grantAndComplete(inputFor(event))),
      );
      expect(crashed._tag).toBe("Left");
      expect(await countEvents(pool)).toBe(0);
      expect(await balanceOf(pool)).toBe(0);

      // Attempt 2 (no crash) — the SAME completion now succeeds for the FIRST
      // time, because nothing from attempt 1 persisted. Exactly-once result.
      const healthy = makePostgresAtomicCompletion({ pool });
      const ok = await Effect.runPromise(
        healthy.grantAndComplete(inputFor(event)),
      );
      expect(ok._tag).toBe("RewardGranted");
      expect(await countEvents(pool)).toBe(1);
      expect(await countGrants(pool)).toBe(1);
      expect(await balanceOf(pool)).toBe(10);
      expect(await countLedgerTx(pool)).toBe(1);
    },
    60_000,
  );

  itPg(
    "None-reward completion: event + grant commit, NO ledger row (NG-1 no-op)",
    async () => {
      if (harness === null) throw new Error("docker harness unavailable");
      const pool = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });
      const { grantAndComplete } = makePostgresAtomicCompletion({ pool });

      const event = await buildCompletion("none_reward");
      const result = await Effect.runPromise(
        grantAndComplete(
          inputFor(event, { delta: { common: 0, rare: 0, legendary: 0 } }),
        ),
      );

      expect(result._tag).toBe("RewardGranted");
      expect(await countEvents(pool)).toBe(1);
      expect(await countGrants(pool)).toBe(1);
      // The proc is never called for a zero-delta reward → no ledger row.
      expect(await countLedgerTx(pool)).toBe(0);
    },
    60_000,
  );
});
