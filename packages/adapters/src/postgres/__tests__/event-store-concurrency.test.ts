/**
 * Postgres event-store CONCURRENCY proof (T-A1 · Lane A).
 *
 * The shared conformance suite exercises CAS SERIALLY (append e1, then attempt
 * a stale append). That proves the CAS *check* but not its correctness under a
 * genuine race. The flatline review of the SDD made the concurrency case
 * load-bearing: READ COMMITTED admits a phantom-read where two writers both see
 * the same tip and both append. This file fires N genuinely-parallel appends
 * that all start from the SAME tip and asserts EXACTLY ONE wins — the real
 * proof that the SERIALIZABLE + FOR UPDATE mechanism holds.
 *
 * It is ADDITIVE: it does not touch the conformance suite. It reuses the same
 * disposable real-Postgres harness (pg-mem would prove nothing — it does not
 * implement SERIALIZABLE / FOR UPDATE).
 */
import { Effect, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ActivityCompleted,
  ActivityId,
  computeEventIdSync,
  IdentityId,
  type PartitionKey,
  type PartitionScope,
  RFC3339Date,
} from "@0xhoneyjar/quests-protocol";

import { makePostgresEventStore } from "../event-store.js";
import { startTestPostgres, type TestPostgres } from "./test-pg.js";

const decode = Schema.decodeUnknownSync;

let harness: TestPostgres | null = null;

beforeAll(async () => {
  harness = await startTestPostgres();
}, 120_000);

afterAll(async () => {
  if (harness !== null) await harness.stop();
});

const activityA = decode(ActivityId)("act_race");
const identityA = decode(IdentityId)("id_race");

const partition: PartitionKey = {
  scope: "activity" as PartitionScope,
  value: activityA as unknown as string,
} as PartitionKey;

const buildEvent = async (nonce: string): Promise<ActivityCompleted> => {
  const draft = {
    event_id: "0".repeat(64),
    preimage_schema_id:
      "https://schemas.freeside.thj/preimage/activity-completed/v1.0.0",
    ts: decode(RFC3339Date)("2026-05-16T00:00:00Z"),
    source_event_hash: null,
    nonce,
    schema_version: "1.0.0" as const,
    $id: "https://schemas.freeside.thj/activity-completed/v1.0.0" as const,
    activity_id: activityA,
    identity_id: identityA,
    period_key: null,
    step_completions: [],
    reward_state_id: null,
  };
  const computed = await computeEventIdSync(
    draft as unknown as Record<string, unknown> & { $id: string; nonce: string | null },
  );
  return decode(ActivityCompleted)({ ...draft, event_id: computed });
};

const itPg = process.env.LOA_PG_CONFORMANCE_SKIP === "1" ? it.skip : it;

describe("EventStoreContract — CAS under genuine concurrency (postgres)", () => {
  itPg(
    "empty-partition race: N parallel appends with expected_tip_hash=null → exactly 1 wins",
    async () => {
      if (harness === null) throw new Error("docker harness unavailable");
      const { contract } = makePostgresEventStore({ pool: harness.freshPool() });

      const N = 8;
      const events = await Promise.all(
        Array.from({ length: N }, (_, i) => buildEvent(`race_${i}`)),
      );

      // All N start from the SAME (empty) tip. Without SERIALIZABLE this admits
      // a phantom: multiple writers see "empty" and all insert. With it, the
      // partition-tip predicate lock forces serialization → 1 winner.
      const results = await Promise.all(
        events.map((e) =>
          Effect.runPromise(
            Effect.either(
              contract.append(e, { partition_key: partition, expected_tip_hash: null }),
            ),
          ),
        ),
      );

      const winners = results.filter((r) => r._tag === "Right");
      const losers = results.filter((r) => r._tag === "Left");

      expect(winners.length).toBe(1);
      expect(losers.length).toBe(N - 1);
      // Every loser is a CAS failure (the partition advanced past null), NOT an
      // infra error or a duplicate.
      for (const l of losers) {
        if (l._tag === "Left") expect(l.left._tag).toBe("CASFailed");
      }

      // The store has exactly ONE event at sequence 1 (no lost-update / no
      // double-insert).
      const read = await Effect.runPromise(contract.read(partition));
      expect(read.length).toBe(1);
      const tip = await Effect.runPromise(contract.getTip(partition));
      expect(tip.monotonic_sequence).toBe(1);
    },
    60_000,
  );

  itPg(
    "non-empty-partition race: N parallel appends from the same real tip → exactly 1 wins",
    async () => {
      if (harness === null) throw new Error("docker harness unavailable");
      const { contract } = makePostgresEventStore({ pool: harness.freshPool() });

      // Seed one event so the partition is non-empty; the racers contend on the
      // FOR UPDATE row lock of this tip.
      const seed = await buildEvent("seed");
      const seedTip = await Effect.runPromise(
        contract.append(seed, { partition_key: partition, expected_tip_hash: null }),
      );

      const N = 8;
      const racers = await Promise.all(
        Array.from({ length: N }, (_, i) => buildEvent(`tiprace_${i}`)),
      );

      const results = await Promise.all(
        racers.map((e) =>
          Effect.runPromise(
            Effect.either(
              contract.append(e, {
                partition_key: partition,
                expected_tip_hash: seedTip.tip_event_id,
              }),
            ),
          ),
        ),
      );

      const winners = results.filter((r) => r._tag === "Right");
      expect(winners.length).toBe(1);
      for (const r of results) {
        if (r._tag === "Left") expect(r.left._tag).toBe("CASFailed");
      }

      // Exactly seed + 1 winner → 2 events, sequences 1 and 2, gapless.
      const read = await Effect.runPromise(contract.read(partition));
      expect(read.length).toBe(2);
      const tip = await Effect.runPromise(contract.getTip(partition));
      expect(tip.monotonic_sequence).toBe(2);
    },
    60_000,
  );

  itPg("different partitions do NOT contend — both parallel appends succeed", async () => {
    if (harness === null) throw new Error("docker harness unavailable");
    const { contract } = makePostgresEventStore({ pool: harness.freshPool() });

    const pA: PartitionKey = {
      scope: "activity" as PartitionScope,
      value: "act_one",
    } as PartitionKey;
    const pB: PartitionKey = {
      scope: "activity" as PartitionScope,
      value: "act_two",
    } as PartitionKey;

    const [eA, eB] = await Promise.all([buildEvent("pa"), buildEvent("pb")]);

    const [rA, rB] = await Promise.all([
      Effect.runPromise(
        Effect.either(contract.append(eA, { partition_key: pA, expected_tip_hash: null })),
      ),
      Effect.runPromise(
        Effect.either(contract.append(eB, { partition_key: pB, expected_tip_hash: null })),
      ),
    ]);

    // No global serialization: writers on distinct partitions both win.
    expect(rA._tag).toBe("Right");
    expect(rB._tag).toBe("Right");
  });
});
