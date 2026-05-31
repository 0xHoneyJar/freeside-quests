/**
 * Wired completion path — the T-A2.5 (cq.16) write-path verification suite.
 *
 * Proves `makeActivityCompletion(...).complete(input)` actually drives the
 * proven atomic seam end-to-end, dispatching on the ActivityReward tag:
 *
 *  1. RESOURCE completion → exactly ONE event_store row + ONE reward_grants row
 *     + ONE resource_transactions row, all in ONE transaction, with the ledger
 *     balance moved by the translated delta (correct tier).
 *
 *  2. IDEMPOTENT REPLAY → replaying the same completion (same event_id) is a
 *     clean no-op: no second grant, no second ledger mutation, balance unchanged.
 *
 *  3. IDENTITY-RESOLUTION FAILURE → a sealed IdentityResolutionFailed error,
 *     and NO partial write (no event, no grant, no ledger row) — resolution runs
 *     BEFORE the txn opens.
 *
 *  4. RESOURCE→DELTA TRANSLATION per tier — canonical tier names + a world alias
 *     map (cubquests cores/essences/crystals → common/rare/legendary) land in the
 *     right ledger column; an unknown kind is a sealed UnknownResourceKind, NOT a
 *     silent {0,0,0} completed-without-reward.
 *
 *  5. BADGEMINT completion → the ActivityCompleted event appends AND a
 *     RewardPendingEvent is recorded (delivery deferred), with NO crash, NO
 *     reward_grants row, NO ledger mutation — a sealed CompletionDeferred.
 *
 * Runs against the disposable REAL-Postgres harness (the same one the adapter
 * atomicity suite uses — pg-mem proves nothing for transaction rollback). The
 * harness + apply_resource_mutation fixture are imported by relative path from
 * the adapters package (cross-package TEST-fixture reuse; no runtime back-edge).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Either, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ActivityCompleted,
  ActivityId,
  ActivityRewardBadgeMint,
  ActivityRewardResource,
  type ChainAddress,
  computeEventIdSync,
  IdentityId,
  type MintIntentId,
  type PartitionKey,
  type PartitionScope,
  RFC3339Date,
} from "@0xhoneyjar/quests-protocol";

import {
  makePostgresAtomicCompletion,
  makePostgresEventStore,
  makePostgresIdentityResolver,
} from "@0xhoneyjar/freeside-activities-adapters/postgres";

import type { EventStorePostgresPool } from "../../../../adapters/src/postgres/pool.js";
import {
  startTestPostgres,
  type TestPostgres,
} from "../../../../adapters/src/postgres/__tests__/test-pg.js";

import {
  makeActivityCompletion,
  translateResourceReward,
  type CompleteActivityInput,
  type ResourceTier,
} from "../complete.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESOURCE_FIXTURE = readFileSync(
  resolve(
    __dirname,
    "../../../../adapters/src/postgres/__tests__/apply-resource-mutation-fixture.sql",
  ),
  "utf8",
);

const decode = Schema.decodeUnknownSync;

const activity = decode(ActivityId)("act_wire");
const identity = decode(IdentityId)("id_wire");
const userAddress = "0xBEEFCAFE00000000000000000000000000000000";
const chain = "evm";

const partition: PartitionKey = {
  scope: "activity" as PartitionScope,
  value: activity as unknown as string,
} as PartitionKey;

const buildCompletion = async (nonce: string): Promise<ActivityCompleted> => {
  const draft = {
    event_id: "0".repeat(64),
    preimage_schema_id:
      "https://schemas.freeside.thj/preimage/activity-completed/v1.0.0",
    ts: decode(RFC3339Date)("2026-05-30T00:00:00Z"),
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

/** A bound identity resolver returning `userAddress` for our test identity. */
const seedResolver = (pool: EventStorePostgresPool, address: string) => {
  const handle = makePostgresIdentityResolver({
    pool,
    supportedChains: new Set([chain]),
  });
  // bind() returns an Effect; run it to seed the binding.
  return Effect.runPromise(
    handle.bind({
      identity_id: identity,
      chain,
      address: address as unknown as ChainAddress,
    }),
  ).then(() => handle.port);
};

const baseInput = (
  event: ActivityCompleted,
  overrides: Partial<CompleteActivityInput> = {},
): CompleteActivityInput => ({
  event,
  reward: ActivityRewardResource.make({ resource_kind: "common", amount: 10 }),
  recipient: identity,
  partition_key: partition,
  expected_tip_hash: null,
  sourceType: "activity_completion",
  sourceId: activity as unknown as string,
  sourceMetadata: { period_key: "2026-W22", step_id: "s1" },
  ...overrides,
});

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
const countLedgerTx = async (pool: EventStorePostgresPool): Promise<number> => {
  const r = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM resource_transactions WHERE user_address = $1`,
    [userAddress.toLowerCase()],
  );
  return Number.parseInt(r.rows[0]?.n ?? "0", 10);
};
const balanceOf = async (
  pool: EventStorePostgresPool,
): Promise<{ common: number; rare: number; legendary: number }> => {
  const r = await pool.query<{
    common: number;
    rare: number;
    legendary: number;
  }>(
    `SELECT common, rare, legendary FROM user_resources WHERE user_address = $1`,
    [userAddress.toLowerCase()],
  );
  const row = r.rows[0];
  return {
    common: row?.common ?? 0,
    rare: row?.rare ?? 0,
    legendary: row?.legendary ?? 0,
  };
};

const wire = (pool: EventStorePostgresPool, resolverPort: unknown) =>
  makeActivityCompletion({
    atomic: makePostgresAtomicCompletion({ pool }),
    eventStore: makePostgresEventStore({ pool }).contract,
    identityResolver:
      resolverPort as Parameters<typeof makeActivityCompletion>[0]["identityResolver"],
    resolutionChain: chain,
    // cubquests world-defined short names → ledger tiers (tiers.ts).
    resourceKindAliases: {
      cores: "common" as ResourceTier,
      essences: "rare" as ResourceTier,
      crystals: "legendary" as ResourceTier,
    },
  });

let harness: TestPostgres | null = null;

beforeAll(async () => {
  harness = await startTestPostgres();
}, 120_000);

afterAll(async () => {
  if (harness !== null) await harness.stop();
});

const itPg = process.env.LOA_PG_CONFORMANCE_SKIP === "1" ? it.skip : it;

/* ── Pure translation unit tests (no DB) ───────────────────────────────────── */

describe("translateResourceReward — resource_kind → ledger delta", () => {
  it("canonical tier names map to the matching column", () => {
    expect(translateResourceReward("common", 7)).toEqual({
      common: 7,
      rare: 0,
      legendary: 0,
    });
    expect(translateResourceReward("rare", 3)).toEqual({
      common: 0,
      rare: 3,
      legendary: 0,
    });
    expect(translateResourceReward("legendary", 1)).toEqual({
      common: 0,
      rare: 0,
      legendary: 1,
    });
  });

  it("world aliases (cubquests cores/essences/crystals) resolve to tiers", () => {
    const aliases = {
      cores: "common" as ResourceTier,
      essences: "rare" as ResourceTier,
      crystals: "legendary" as ResourceTier,
    };
    expect(translateResourceReward("cores", 100, aliases)).toEqual({
      common: 100,
      rare: 0,
      legendary: 0,
    });
    expect(translateResourceReward("essences", 20, aliases)).toEqual({
      common: 0,
      rare: 20,
      legendary: 0,
    });
    expect(translateResourceReward("crystals", 5, aliases)).toEqual({
      common: 0,
      rare: 0,
      legendary: 5,
    });
  });

  it("an unknown resource_kind returns null (caller seals it, never zeroes)", () => {
    expect(translateResourceReward("unobtanium", 10)).toBeNull();
    expect(translateResourceReward("fuel", 10, { cores: "common" })).toBeNull();
  });
});

/* ── Real-Postgres wired-path tests ────────────────────────────────────────── */

describe("makeActivityCompletion — Resource grant is atomic + idempotent (postgres)", () => {
  itPg("Resource completion: ONE event + ONE grant + ONE ledger tx, correct tier", async () => {
    if (harness === null) throw new Error("docker harness unavailable");
    const pool = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });
    const resolverPort = await seedResolver(pool, userAddress);
    const handle = wire(pool, resolverPort);

    const event = await buildCompletion("resource-rare");
    const outcome = await Effect.runPromise(
      handle.complete(
        baseInput(event, {
          reward: ActivityRewardResource.make({
            resource_kind: "rare",
            amount: 25,
          }),
        }),
      ),
    );

    expect(outcome._tag).toBe("CompletionGranted");
    if (outcome._tag === "CompletionGranted") {
      expect(outcome.userAddress).toBe(userAddress);
      expect(outcome.delta).toEqual({ common: 0, rare: 25, legendary: 0 });
      expect(outcome.grant._tag).toBe("RewardGranted");
    }

    expect(await countEvents(pool)).toBe(1);
    expect(await countGrants(pool)).toBe(1);
    expect(await countLedgerTx(pool)).toBe(1);
    expect(await balanceOf(pool)).toEqual({ common: 0, rare: 25, legendary: 0 });
  });

  itPg("idempotent replay of the SAME completion → no double-grant", async () => {
    if (harness === null) throw new Error("docker harness unavailable");
    const pool = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });
    const resolverPort = await seedResolver(pool, userAddress);
    const handle = wire(pool, resolverPort);

    const event = await buildCompletion("idem");
    const input = baseInput(event, {
      reward: ActivityRewardResource.make({ resource_kind: "common", amount: 10 }),
    });

    const first = await Effect.runPromise(handle.complete(input));
    expect(first._tag).toBe("CompletionGranted");
    expect(await balanceOf(pool)).toEqual({ common: 10, rare: 0, legendary: 0 });

    // Replay the EXACT same completion (same event_id). The event_id
    // duplicate-reject fires, the txn rolls back, NOTHING downstream runs.
    const replay = await Effect.runPromise(
      handle.complete(input).pipe(Effect.either),
    );
    expect(replay._tag).toBe("Left");
    if (Either.isLeft(replay)) {
      // AtomicGrantFailed wrapping a DuplicateEvent — the seam's no-op path.
      expect(replay.left._tag).toBe("AtomicGrantFailed");
    }

    // Exactly one of everything; balance unchanged.
    expect(await countEvents(pool)).toBe(1);
    expect(await countGrants(pool)).toBe(1);
    expect(await countLedgerTx(pool)).toBe(1);
    expect(await balanceOf(pool)).toEqual({ common: 10, rare: 0, legendary: 0 });
  });

  itPg("identity-resolution failure → sealed error, NO partial write", async () => {
    if (harness === null) throw new Error("docker harness unavailable");
    const pool = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });
    // Resolver with NO binding for our identity → UnresolvableIdentity.
    const emptyResolver = makePostgresIdentityResolver({
      pool,
      supportedChains: new Set([chain]),
    }).port;
    const handle = wire(pool, emptyResolver);

    const event = await buildCompletion("unresolvable");
    const result = await Effect.runPromise(
      handle.complete(baseInput(event)).pipe(Effect.either),
    );

    expect(result._tag).toBe("Left");
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("IdentityResolutionFailed");
    }

    // Resolution runs BEFORE the txn → nothing persisted anywhere.
    expect(await countEvents(pool)).toBe(0);
    expect(await countGrants(pool)).toBe(0);
    expect(await countLedgerTx(pool)).toBe(0);
  });

  itPg("world-alias Resource (cubquests 'crystals') lands in legendary column", async () => {
    if (harness === null) throw new Error("docker harness unavailable");
    const pool = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });
    const resolverPort = await seedResolver(pool, userAddress);
    const handle = wire(pool, resolverPort);

    const event = await buildCompletion("crystals");
    const outcome = await Effect.runPromise(
      handle.complete(
        baseInput(event, {
          reward: ActivityRewardResource.make({
            resource_kind: "crystals",
            amount: 4,
          }),
        }),
      ),
    );
    expect(outcome._tag).toBe("CompletionGranted");
    if (outcome._tag === "CompletionGranted") {
      expect(outcome.delta).toEqual({ common: 0, rare: 0, legendary: 4 });
    }
    expect(await balanceOf(pool)).toEqual({ common: 0, rare: 0, legendary: 4 });
  });

  itPg("unknown resource_kind → sealed UnknownResourceKind, NO write", async () => {
    if (harness === null) throw new Error("docker harness unavailable");
    const pool = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });
    const resolverPort = await seedResolver(pool, userAddress);
    const handle = wire(pool, resolverPort);

    const event = await buildCompletion("unknown-kind");
    const result = await Effect.runPromise(
      handle
        .complete(
          baseInput(event, {
            reward: ActivityRewardResource.make({
              resource_kind: "unobtanium",
              amount: 99,
            }),
          }),
        )
        .pipe(Effect.either),
    );
    expect(result._tag).toBe("Left");
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("UnknownResourceKind");
    }
    expect(await countEvents(pool)).toBe(0);
    expect(await countGrants(pool)).toBe(0);
    expect(await countLedgerTx(pool)).toBe(0);
  });
});

describe("makeActivityCompletion — non-Resource delivery is gracefully deferred (postgres)", () => {
  itPg("BadgeMint completion → event + RewardPending recorded, NO grant, NO crash", async () => {
    if (harness === null) throw new Error("docker harness unavailable");
    const pool = harness.freshPool({ extraDdl: [RESOURCE_FIXTURE] });
    const resolverPort = await seedResolver(pool, userAddress);
    const handle = wire(pool, resolverPort);

    const event = await buildCompletion("badge");
    const outcome = await Effect.runPromise(
      handle.complete(
        baseInput(event, {
          reward: ActivityRewardBadgeMint.make({
            mint_intent_id: ("mint_" + "a".repeat(40)) as unknown as MintIntentId,
          }),
        }),
      ),
    );

    expect(outcome._tag).toBe("CompletionDeferred");
    if (outcome._tag === "CompletionDeferred") {
      expect(outcome.rewardTag).toBe("BadgeMint");
      expect(outcome.completionEventId).toBe(event.event_id);
      expect(outcome.pendingEventId).not.toBe(event.event_id);
      expect(outcome.reason).toContain("freeside-mint");
    }

    // TWO events appended (ActivityCompleted + RewardPendingEvent); but NO
    // reward_grants row and NO ledger mutation — a false grant would be a bug.
    expect(await countEvents(pool)).toBe(2);
    expect(await countGrants(pool)).toBe(0);
    expect(await countLedgerTx(pool)).toBe(0);
    expect(await balanceOf(pool)).toEqual({ common: 0, rare: 0, legendary: 0 });

    // The 2nd event IS a RewardPendingEvent chained off the completion.
    const events = await pool.query<{ event_envelope: { $id: string; source_event_hash: string } }>(
      `SELECT event_envelope FROM event_store
        WHERE scope = $1 AND partition_value = $2
        ORDER BY monotonic_sequence ASC`,
      [partition.scope, partition.value],
    );
    const pending = events.rows[1]?.event_envelope;
    expect(pending?.$id).toBe(
      "https://schemas.freeside.thj/reward-pending/v1.0.0",
    );
    expect(pending?.source_event_hash).toBe(event.event_id);
  });
});
