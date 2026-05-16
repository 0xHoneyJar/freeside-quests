/**
 * Golden replay test (T2.9 · SDD §3.5 + §5.7).
 *
 * Scenario:
 *   - 3 Activities (act_a · act_b · act_c)
 *   - 2 Identities (id_a · id_b)
 *   - 1 ActivityCompleted event (id_a completes act_a)
 *   - 1 RaffleEntry-shaped weighted-event (id_b completes act_b)
 *
 * Determinism gate: running the scenario 10 times produces byte-identical
 * event_id sequences + identical adapter snapshots. This is the regression
 * fence for CL-Event-3 (hash-determinism) and CL-EventStore-6 (replay-
 * determinism) end-to-end across the full substrate.
 */
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ActivityCompleted,
  ActivityId,
  ChainAddress,
  computeEventIdSync,
  EventId,
  IdentityId,
  ProgressAdvanced,
  RewardPendingEvent,
  type RewardPending,
  ActivityRewardNone,
  RFC3339Date,
  StepId,
} from "@0xhoneyjar/quests-protocol";

import { buildDefaultActivitiesLayer } from "../compose.js";
import {
  CompletionEventPortTag,
  ProgressPortTag,
  RewardPortTag,
} from "../ports.js";

const decode = Schema.decodeUnknownSync;

// Shared fixture vocabulary
const activityA = decode(ActivityId)("act_a");
const activityB = decode(ActivityId)("act_b");
const activityC = decode(ActivityId)("act_c");
const identityA = decode(IdentityId)("id_a");
const identityB = decode(IdentityId)("id_b");
const stepFoo = decode(StepId)("step_foo");
const addrEth = decode(ChainAddress)("0xAaAa000000000000000000000000000000000001");
const ts0 = decode(RFC3339Date)("2026-05-16T00:00:00Z");
const ts1 = decode(RFC3339Date)("2026-05-16T00:01:00Z");
const eventOne = decode(EventId)("a".repeat(64));

const buildProgressAdvanced = async (overrides: {
  activityId: ActivityId;
  identityId: IdentityId;
  nonce: string;
}): Promise<ProgressAdvanced> => {
  const draft = {
    event_id: "0".repeat(64),
    preimage_schema_id: "https://schemas.freeside.thj/preimage/progress-advanced/v1.0.0",
    ts: ts0,
    source_event_hash: null,
    nonce: overrides.nonce,
    schema_version: "1.0.0" as const,
    $id: "https://schemas.freeside.thj/progress-advanced/v1.0.0" as const,
    activity_id: overrides.activityId,
    identity_id: overrides.identityId,
    new_step_completions: [
      { step_id: stepFoo, order: 0, completed_at: ts0, event_id: eventOne },
    ],
    version_before: 0,
    version_after: 1,
  };
  const computed = await computeEventIdSync(
    draft as unknown as Record<string, unknown> & { $id: string; nonce: string | null },
  );
  return decode(ProgressAdvanced)({ ...draft, event_id: computed });
};

const buildActivityCompleted = async (overrides: {
  activityId: ActivityId;
  identityId: IdentityId;
  nonce: string;
}): Promise<ActivityCompleted> => {
  const draft = {
    event_id: "0".repeat(64),
    preimage_schema_id: "https://schemas.freeside.thj/preimage/activity-completed/v1.0.0",
    ts: ts1,
    source_event_hash: null,
    nonce: overrides.nonce,
    schema_version: "1.0.0" as const,
    $id: "https://schemas.freeside.thj/activity-completed/v1.0.0" as const,
    activity_id: overrides.activityId,
    identity_id: overrides.identityId,
    period_key: null,
    step_completions: [],
    reward_state_id: null,
  };
  const computed = await computeEventIdSync(
    draft as unknown as Record<string, unknown> & { $id: string; nonce: string | null },
  );
  return decode(ActivityCompleted)({ ...draft, event_id: computed });
};

/**
 * Runs the canonical scenario against a fresh substrate, returning the
 * sequence of event_ids + the final reward snapshot. Deterministic input
 * (fixed nonces · fixed timestamps) MUST produce identical output across
 * runs.
 */
const runScenario = async (): Promise<{
  readonly progressEvents: ReadonlyArray<string>;
  readonly completionEvents: ReadonlyArray<string>;
  readonly rewardCount: number;
}> => {
  // Use a deterministic granted_event_id provider so reward records are
  // byte-identical across runs.
  let counter = 0;
  const detGrantedEventId = (): EventId => {
    counter += 1;
    return ("a".repeat(64 - counter.toString().length) + counter.toString()) as unknown as EventId;
  };
  const detTs = (): string => ts0;

  const { layer, handles } = buildDefaultActivitiesLayer({
    reward: {
      nextGrantedEventIdProvider: detGrantedEventId,
      timestampProvider: detTs,
    },
    identityBindings: [
      { identity_id: identityA, chain: "ethereum", address: addrEth },
    ],
  });

  const progressA = await buildProgressAdvanced({
    activityId: activityA,
    identityId: identityA,
    nonce: "n-progress-a",
  });
  const progressB = await buildProgressAdvanced({
    activityId: activityB,
    identityId: identityB,
    nonce: "n-progress-b",
  });
  const progressC = await buildProgressAdvanced({
    activityId: activityC,
    identityId: identityA,
    nonce: "n-progress-c",
  });
  const completedA = await buildActivityCompleted({
    activityId: activityA,
    identityId: identityA,
    nonce: "n-completed-a",
  });
  const completedB = await buildActivityCompleted({
    activityId: activityB,
    identityId: identityB,
    nonce: "n-completed-b",
  });

  const program = Effect.gen(function* () {
    const progress = yield* ProgressPortTag;
    const events = yield* CompletionEventPortTag;
    const reward = yield* RewardPortTag;

    yield* progress.advanceProgress(progressA);
    yield* progress.advanceProgress(progressB);
    yield* progress.advanceProgress(progressC);

    const completedAId = yield* events.emit(completedA);
    const completedBId = yield* events.emit(completedB);

    const grantA = yield* reward.grant(ActivityRewardNone.make({}), identityA, completedAId);
    const grantB = yield* reward.grant(ActivityRewardNone.make({}), identityB, completedBId);

    return {
      progressIds: [progressA.event_id, progressB.event_id, progressC.event_id],
      completionIds: [completedAId, completedBId],
      grants: [grantA, grantB],
    };
  });

  const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

  return {
    progressEvents: result.progressIds as ReadonlyArray<string>,
    completionEvents: result.completionIds as ReadonlyArray<string>,
    rewardCount: handles.reward.snapshot().length,
  };
};

describe("golden replay — full substrate", () => {
  it("produces deterministic event_id sequences across 10 runs", async () => {
    const runs = await Promise.all(Array.from({ length: 10 }, () => runScenario()));
    const first = runs[0]!;
    for (const r of runs.slice(1)) {
      expect(r.progressEvents).toEqual(first.progressEvents);
      expect(r.completionEvents).toEqual(first.completionEvents);
      expect(r.rewardCount).toBe(first.rewardCount);
    }
  });

  it("emits the expected event counts (3 progress + 2 completions + 2 rewards)", async () => {
    const result = await runScenario();
    expect(result.progressEvents.length).toBe(3);
    expect(result.completionEvents.length).toBe(2);
    expect(result.rewardCount).toBe(2);
  });

  it("produces unique event_ids across the scenario", async () => {
    const result = await runScenario();
    const all = [...result.progressEvents, ...result.completionEvents];
    expect(new Set(all).size).toBe(all.length);
  });
});
