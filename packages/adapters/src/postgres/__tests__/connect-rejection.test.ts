/**
 * Connect-rejection sealing proof — the defect #21.2 suite (Lane A).
 *
 * The MOST COMMON transient fault on the write path is `pool.connect()`
 * rejecting (pool exhaustion / DB unreachable / a shutdown race). Before the
 * fix, connect() ran OUTSIDE the try — so via Effect.promise a connect rejection
 * became an unrecoverable Effect DEFECT, breaking the "NEVER throws — every
 * failure is a sealed error" contract on exactly the fault most likely to fire.
 *
 * These tests mock a pool whose connect() rejects and assert the Effect FAILS
 * (Exit.Failure with a sealed _tag), NOT defects (Exit.Failure with a Die).
 * No Docker / no real Postgres needed — the connect rejection short-circuits
 * before any SQL runs.
 */
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

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
import { Schema } from "effect";

import { makePostgresAtomicCompletion } from "../atomic-completion.js";
import { makePostgresEventStore } from "../event-store.js";
import type { EventStorePostgresPool } from "../pool.js";

const decode = Schema.decodeUnknownSync;

/**
 * A pool whose connect() ALWAYS rejects. query() also rejects (the adapters'
 * non-transactional reads use it) — but the append/atomic paths hit connect()
 * first, which is the defect-#21.2 surface.
 */
const connectRejectingPool = (): EventStorePostgresPool => ({
  // eslint-disable-next-line @typescript-eslint/require-await
  query: async () => {
    throw Object.assign(new Error("ECONNREFUSED: db unreachable"), {
      code: "ECONNREFUSED",
    });
  },
  // eslint-disable-next-line @typescript-eslint/require-await
  connect: async () => {
    throw Object.assign(new Error("pool exhausted / db unreachable"), {
      code: "53300", // too_many_connections (illustrative; any reject suffices)
    });
  },
});

const activity = decode(ActivityId)("act_connectreject");
const identity = decode(IdentityId)("id_connectreject");

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

describe("Defect #21.2 — pool.connect() rejection seals into an error, not a defect", () => {
  it("event-store append: connect rejection → sealed EventStoreUnavailable (no Die)", async () => {
    const { contract } = makePostgresEventStore({
      pool: connectRejectingPool(),
      // No retry budget so we surface the sealed error immediately.
      maxSerializationRetries: 0,
    });
    const event = await buildCompletion("es_connect");

    const exit = await Effect.runPromiseExit(
      contract.append(event as unknown as ActivityCompleted, {
        partition_key: partition,
        expected_tip_hash: null,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      // CRITICAL: it is a Fail (sealed error), NOT a Die (defect).
      const dieOption = Cause.dieOption(exit.cause);
      expect(dieOption._tag).toBe("None"); // no defect
      const failOption = Cause.failureOption(exit.cause);
      expect(failOption._tag).toBe("Some");
      if (failOption._tag === "Some") {
        const err = failOption.value as { readonly _tag: string; readonly retryable?: boolean };
        expect(err._tag).toBe("EventStoreUnavailable");
        expect(err.retryable).toBe(true);
      }
    }
  });

  it("atomic-completion: connect rejection → sealed RewardAdapterUnavailable (no Die)", async () => {
    const { grantAndComplete } = makePostgresAtomicCompletion({
      pool: connectRejectingPool(),
      maxSerializationRetries: 0,
      // skip the verify path so we don't need a real event_id hash dependency
      // for this fault — the connect rejection is what we're isolating.
      verifyEventId: true,
    });
    const event = await buildCompletion("ac_connect");

    const exit = await Effect.runPromiseExit(
      grantAndComplete({
        event: event as unknown as Parameters<typeof grantAndComplete>[0]["event"],
        partition_key: partition,
        expected_tip_hash: null,
        reward: ActivityRewardResource.make({ resource_kind: "core", amount: 10 }),
        recipient: identity,
        userAddress: "0xfeedface00000000000000000000000000000000",
        delta: { common: 10, rare: 0, legendary: 0 },
        resourceIdempotencyKey: event.event_id as unknown as string,
        sourceType: "activity_completion",
        sourceId: activity as unknown as string,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const dieOption = Cause.dieOption(exit.cause);
      expect(dieOption._tag).toBe("None"); // no defect
      const failOption = Cause.failureOption(exit.cause);
      expect(failOption._tag).toBe("Some");
      if (failOption._tag === "Some") {
        const err = failOption.value as { readonly _tag: string };
        expect(err._tag).toBe("AdapterUnavailable");
      }
    }
  });
});
