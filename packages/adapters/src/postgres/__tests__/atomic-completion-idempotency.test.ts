/**
 * Atomicity-bridge IDEMPOTENCY + PROVENANCE proofs (defects #21.4/.5/.6/.9).
 *
 * These are the reward-correctness teeth that the original atomicity suite
 * (atomic-completion.test.ts) did NOT cover. They run against the disposable
 * real-Postgres harness with the apply_resource_mutation fixture, which now
 * carries the prod partial-unique index (defect #21.5).
 *
 * Covered:
 *
 *   #21.4 — the bridge ENFORCES resourceIdempotencyKey === event_id, so the
 *           host's coarse legacy resource key cannot let two distinct-event
 *           completions share one resource key → no completed-without-reward.
 *           Also: the belt-and-suspenders zero-delta-with-expected-reward
 *           rollback when a divergent key reaches the proc.
 *
 *   #21.5 — the fixture has the prod partial-unique index
 *           (user_address, resource_type, idempotency_key) WHERE
 *           idempotency_key IS NOT NULL, so the check-then-insert TOCTOU has a
 *           race-safe backstop.
 *
 *   #21.6 — a 23505 from that index is classified NON-retryable (deterministic),
 *           not retried as a transient serialization failure.
 *
 *   #21.9 — the ledger row's metadata carries the caller's provenance
 *           (period_key/step_id) merged with idempotencyKey, matching the
 *           legacy path's `{ period_key, step_id }`.
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

const activity = decode(ActivityId)("act_idem");
const identity = decode(IdentityId)("id_idem");
const userAddress = "0xfeedface00000000000000000000000000000000";

const partition: PartitionKey = {
  scope: "activity" as PartitionScope,
  value: activity as unknown as string,
} as PartitionKey;

const buildCompletion = async (nonce: string): Promise<ActivityCompleted> => {
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

const balanceOf = async (pool: EventStorePostgresPool): Promise<number> => {
  const r = await pool.query<{ common: number }>(
    `SELECT common FROM user_resources WHERE user_address = $1`,
    [userAddress.toLowerCase()],
  );
  return r.rows[0]?.common ?? 0;
};
const countEvents = async (pool: EventStorePostgresPool): Promise<number> => {
  const r = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM event_store WHERE scope=$1 AND partition_value=$2`,
    [partition.scope, partition.value],
  );
  return Number.parseInt(r.rows[0]?.n ?? "0", 10);
};
const countGrants = async (pool: EventStorePostgresPool): Promise<number> => {
  const r = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM reward_grants WHERE recipient=$1`,
    [identity as unknown as string],
  );
  return Number.parseInt(r.rows[0]?.n ?? "0", 10);
};

const itPg = process.env.LOA_PG_CONFORMANCE_SKIP === "1" ? it.skip : it;

describe("Atomicity bridge — idempotency + provenance (postgres)", () => {
  itPg(
    "#21.4 boundary: a divergent resourceIdempotencyKey (≠ event_id) is REJECTED before the txn",
    async () => {
      if (harness === null) throw new Error("docker harness unavailable");
      const pool = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });
      const { grantAndComplete } = makePostgresAtomicCompletion({ pool });

      const event = await buildCompletion("diverge_key");
      // The host's coarse legacy key, NOT the event_id — the exact mistake that
      // would let two distinct completions share a resource key.
      const coarseKey = "act_idem|global|step1|0xfeed";

      const outcome = await Effect.runPromise(
        Effect.either(
          grantAndComplete(inputFor(event, { resourceIdempotencyKey: coarseKey })),
        ),
      );
      expect(outcome._tag).toBe("Left");
      if (outcome._tag === "Left") {
        expect(outcome.left._tag).toBe("SchemaValidation");
      }
      // NOTHING persisted — the rejection is pre-transaction.
      expect(await countEvents(pool)).toBe(0);
      expect(await countGrants(pool)).toBe(0);
      expect(await balanceOf(pool)).toBe(0);
    },
    60_000,
  );

  itPg(
    "#21.4 belt-and-suspenders: zero-delta-with-expected-reward (divergent key escaping the check) ROLLS BACK",
    async () => {
      if (harness === null) throw new Error("docker harness unavailable");
      const pool = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });
      // First completion lands a ledger row under a SHARED coarse key.
      const sharedKey = "shared-coarse-key";
      const first = await buildCompletion("first_complete");
      const completer = makePostgresAtomicCompletion({
        pool,
        // Opt out of the boundary so we can reach the proc with a key that is
        // SHARED across two distinct events — this is precisely the host's
        // coarse-legacy-key hazard, and the belt-and-suspenders must catch it.
        enforceResourceKeyIsEventId: false,
      });
      const r1 = await Effect.runPromise(
        completer.grantAndComplete(inputFor(first, { resourceIdempotencyKey: sharedKey })),
      );
      expect(r1._tag).toBe("RewardGranted");
      expect(await balanceOf(pool)).toBe(10);

      // Second, DISTINCT completion (different event_id) reuses the SAME coarse
      // resource key. It must pass STEP-1 CAS to REACH the proc, so it carries
      // the CORRECT current tip (the first event's id). The proc's idempotency
      // check then no-ops (zero delta) — but the event+grant would otherwise
      // commit → completed-WITHOUT-reward. The belt-and-suspenders detects
      // applied=0 && expected>0 and ROLLS BACK (so the CAS does NOT short-circuit
      // the test before STEP 3).
      const second = await buildCompletion("second_complete");
      const outcome = await Effect.runPromise(
        Effect.either(
          completer.grantAndComplete(
            inputFor(second, {
              resourceIdempotencyKey: sharedKey,
              expected_tip_hash: first.event_id as unknown as GrantAndCompleteInput["expected_tip_hash"],
            }),
          ),
        ),
      );
      expect(outcome._tag).toBe("Left");
      if (outcome._tag === "Left") {
        expect(outcome.left._tag).toBe("ResourceMutationFailed");
        if (outcome.left._tag === "ResourceMutationFailed") {
          expect(outcome.left.retryable).toBe(false);
        }
      }
      // Balance untouched (no double-apply) AND the 2nd event/grant did NOT
      // commit (no completed-without-reward): exactly ONE event, ONE grant.
      expect(await balanceOf(pool)).toBe(10);
      expect(await countEvents(pool)).toBe(1);
      expect(await countGrants(pool)).toBe(1);
    },
    60_000,
  );

  itPg(
    "#21.5 fixture has the prod partial-unique index (the TOCTOU backstop)",
    async () => {
      if (harness === null) throw new Error("docker harness unavailable");
      const pool = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });
      // The fixture must carry the canonical prod index — grounded in
      // cubquests-interface 20251102225424. Assert it exists by name + columns,
      // scoped to the per-factory schema (search_path = current_schema()).
      const idx = await pool.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
          WHERE tablename = 'resource_transactions'
            AND schemaname = current_schema()
            AND indexname = 'resource_transactions_user_type_idempotency_idx'`,
      );
      expect(idx.rows.length).toBe(1);
      const def = idx.rows[0]!.indexdef.toLowerCase();
      expect(def).toContain("unique");
      expect(def).toContain("user_address");
      expect(def).toContain("resource_type");
      expect(def).toContain("idempotency_key");
      expect(def).toContain("idempotency_key is not null"); // PARTIAL
    },
    60_000,
  );

  itPg(
    "#21.6 a 23505 from the resource unique index is classified NON-retryable (not retry-spun)",
    async () => {
      if (harness === null) throw new Error("docker harness unavailable");
      const pool = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });

      // A resource fn that does a PLAIN INSERT (no check, no ON CONFLICT) so a
      // duplicate (user_address, resource_type, idempotency_key) trips the prod
      // partial-unique index → 23505 propagates straight to the bridge. This
      // isolates the bridge's classification: a 23505 here is a DETERMINISTIC
      // idempotency conflict, NOT a transient serialization failure, so the
      // bridge MUST surface ResourceMutationFailed{retryable:false} and MUST NOT
      // retry it maxRetries times (retry.ts would otherwise loop forever).
      let procCalls = 0;
      const PLAIN_INSERT_FN = `
        CREATE OR REPLACE FUNCTION plain_insert_mutation(
          p_user_address text, p_source_type text,
          p_common integer DEFAULT 0, p_rare integer DEFAULT 0, p_legendary integer DEFAULT 0,
          p_source_id text DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb,
          p_idempotency_key text DEFAULT NULL, p_authorizer text DEFAULT NULL
        ) RETURNS TABLE(common integer, rare integer, legendary integer,
                        common_transaction_id uuid, rare_transaction_id uuid, legendary_transaction_id uuid)
        LANGUAGE plpgsql AS $$
        BEGIN
          INSERT INTO resource_transactions
            (user_address, resource_type, amount, balance_after, source_type, source_id,
             metadata, idempotency_key, authorizer, created_at)
          VALUES (lower(trim(p_user_address)), 'common', p_common, p_common, p_source_type,
                  p_source_id, p_metadata, p_idempotency_key, p_authorizer, now());
          RETURN QUERY SELECT p_common, p_rare, p_legendary, NULL::uuid, NULL::uuid, NULL::uuid;
        END; $$;`;
      await pool.query(PLAIN_INSERT_FN);

      const completer = makePostgresAtomicCompletion({
        pool,
        resourceMutationFn: "plain_insert_mutation",
        enforceResourceKeyIsEventId: false,
        // A generous retry budget: a CORRECT classification must NOT consume it.
        maxSerializationRetries: 5,
      });

      const sharedKey = "dup-resource-key";
      // First completion inserts the ledger row under sharedKey.
      const first = await buildCompletion("idx_first");
      const r1 = await Effect.runPromise(
        completer.grantAndComplete(inputFor(first, { resourceIdempotencyKey: sharedKey })),
      );
      expect(r1._tag).toBe("RewardGranted");
      procCalls += 1;

      // Second, DISTINCT completion reuses sharedKey → the plain INSERT trips the
      // partial-unique index (#21.5) → 23505. The bridge must classify it
      // NON-retryable (#21.6).
      const second = await buildCompletion("idx_second");
      const start = Date.now();
      const outcome = await Effect.runPromise(
        Effect.either(
          completer.grantAndComplete(
            inputFor(second, {
              resourceIdempotencyKey: sharedKey,
              expected_tip_hash: first.event_id as unknown as GrantAndCompleteInput["expected_tip_hash"],
            }),
          ),
        ),
      );
      const elapsed = Date.now() - start;

      expect(outcome._tag).toBe("Left");
      if (outcome._tag === "Left") {
        expect(outcome.left._tag).toBe("ResourceMutationFailed");
        if (outcome.left._tag === "ResourceMutationFailed") {
          expect(outcome.left.retryable).toBe(false);
        }
      }
      // Sanity that it did NOT spin through a retry storm (a misclassified
      // retryable 23505 with maxRetries=5 would re-run the whole txn 5x). The
      // deterministic reject returns promptly.
      expect(elapsed).toBeLessThan(5_000);
      // The custom plain-insert proc writes only resource_transactions (not
      // user_resources), so we assert on the ledger row: exactly ONE row exists
      // for sharedKey — the 2nd completion's 23505-rejected insert did NOT
      // commit a second row (the whole unit-of-work rolled back).
      const ledger = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM resource_transactions
          WHERE user_address = $1 AND idempotency_key = $2`,
        [userAddress.toLowerCase(), sharedKey],
      );
      expect(Number.parseInt(ledger.rows[0]?.n ?? "0", 10)).toBe(1);
      // And exactly one event + one grant committed (the 2nd rolled back).
      expect(await countEvents(pool)).toBe(1);
      expect(await countGrants(pool)).toBe(1);
      expect(procCalls).toBe(1);
    },
    60_000,
  );

  itPg(
    "#21.9 provenance: ledger metadata carries period_key/step_id merged with idempotencyKey",
    async () => {
      if (harness === null) throw new Error("docker harness unavailable");
      const pool = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });
      const { grantAndComplete } = makePostgresAtomicCompletion({ pool });

      const event = await buildCompletion("provenance");
      const sourceMetadata = { period_key: "2026-W21", step_id: "step_foo" };
      const result = await Effect.runPromise(
        grantAndComplete(inputFor(event, { sourceMetadata })),
      );
      expect(result._tag).toBe("RewardGranted");

      // The ledger row's metadata MUST carry the caller's provenance (matching
      // the legacy path's { period_key, step_id }) AND the idempotencyKey
      // (matching the prod proc's `v_metadata || { idempotencyKey }`).
      const row = await pool.query<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM resource_transactions
          WHERE user_address=$1 AND resource_type='common' LIMIT 1`,
        [userAddress.toLowerCase()],
      );
      const meta = row.rows[0]?.metadata ?? {};
      expect(meta.period_key).toBe("2026-W21");
      expect(meta.step_id).toBe("step_foo");
      expect(meta.idempotencyKey).toBe(event.event_id as unknown as string);
    },
    60_000,
  );
});
