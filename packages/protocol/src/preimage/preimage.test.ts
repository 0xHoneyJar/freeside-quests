import { Either, ParseResult, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ActivityCompletedPreimage,
  BadgeIssuedPreimage,
  PreimageEnvelope,
  ProgressAdvancedPreimage,
  RaffleDrawnPreimage,
  RewardFailedPreimage,
  RewardGrantedPreimage,
  RewardPendingPreimage,
} from "./index.js";

const expectFail = <A, I>(schema: Schema.Schema<A, I>, input: unknown) => {
  const result = Schema.decodeUnknownEither(schema)(input);
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isLeft(result)) {
    expect(ParseResult.isParseError(result.left)).toBe(true);
  }
};

const ZERO_HASH = "0".repeat(64);
const SAMPLE_HASH = "a".repeat(64);
const VALID_TS = "2026-05-15T12:34:56Z";

const baseEnvelope = {
  preimage_schema_id: "https://schemas.freeside.thj/preimage/some/v1.0.0",
  ts: VALID_TS,
  source_event_hash: null,
  nonce: null,
  schema_version: "1.0.0" as const,
  $id: "https://schemas.freeside.thj/some/v1.0.0",
};

describe("PreimageEnvelope (§5.6 · T1.8 · common shape minus event_id)", () => {
  it("decodes the canonical preimage shape (no event_id required)", () => {
    const v = Schema.decodeUnknownSync(PreimageEnvelope)(baseEnvelope);
    expect(v.schema_version).toBe("1.0.0");
    expect(v.ts).toBe(VALID_TS);
  });

  it("DOES NOT carry an event_id field on its type", () => {
    const v = Schema.decodeUnknownSync(PreimageEnvelope)(baseEnvelope);
    expect("event_id" in v).toBe(false);
  });

  it("rejects non-RFC3339 ts", () => {
    expectFail(PreimageEnvelope, { ...baseEnvelope, ts: "2026-05-15" });
  });

  it("rejects schema_version not equal to literal '1.0.0'", () => {
    expectFail(PreimageEnvelope, { ...baseEnvelope, schema_version: "2.0.0" });
  });

  it("accepts a valid hash for source_event_hash (chained event)", () => {
    const v = Schema.decodeUnknownSync(PreimageEnvelope)({
      ...baseEnvelope,
      source_event_hash: SAMPLE_HASH,
    });
    expect(v.source_event_hash).toBe(SAMPLE_HASH);
  });
});

describe("ActivityCompletedPreimage (§5.6 · per CL-Event-3)", () => {
  const validPreimage = {
    ...baseEnvelope,
    $id: "https://schemas.freeside.thj/activity-completed/v1.0.0",
    preimage_schema_id: "https://schemas.freeside.thj/preimage/activity-completed/v1.0.0",
    activity_id: "act_quest1",
    identity_id: "id_player001",
    period_key: null,
    step_completions: [],
    reward_state_id: null,
  };

  it("decodes a minimal ActivityCompleted preimage", () => {
    const v = Schema.decodeUnknownSync(ActivityCompletedPreimage)(validPreimage);
    expect(v.activity_id).toBe("act_quest1");
    expect("event_id" in v).toBe(false);
  });

  it("rejects $id pointing to a different event type", () => {
    expectFail(ActivityCompletedPreimage, {
      ...validPreimage,
      $id: "https://schemas.freeside.thj/badge-issued/v1.0.0",
    });
  });

  it("rejects malformed activity_id", () => {
    expectFail(ActivityCompletedPreimage, { ...validPreimage, activity_id: "quest1" });
  });

  it("accepts a chain of step_completions in the order the producer hands them", () => {
    // Note: the canonical sort by (order, step_id) is applied at HASH time
    // by computeEventId, not at decode time. The preimage schema only
    // validates the shape — array order is preserved as-given.
    const v = Schema.decodeUnknownSync(ActivityCompletedPreimage)({
      ...validPreimage,
      step_completions: [
        {
          step_id: "step_b",
          order: 0,
          completed_at: VALID_TS,
          event_id: ZERO_HASH,
        },
        {
          step_id: "step_a",
          order: 0,
          completed_at: VALID_TS,
          event_id: ZERO_HASH,
        },
      ],
    });
    expect(v.step_completions.length).toBe(2);
    // Decoded order matches input order — the sort is a hash-time concern.
    expect(v.step_completions[0]?.step_id).toBe("step_b");
  });
});

describe("BadgeIssuedPreimage / RaffleDrawnPreimage / ProgressAdvancedPreimage", () => {
  it("BadgeIssuedPreimage decodes with merkle proof + snapshot binding", () => {
    const v = Schema.decodeUnknownSync(BadgeIssuedPreimage)({
      ...baseEnvelope,
      $id: "https://schemas.freeside.thj/badge-issued/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/badge-issued/v1.0.0",
      activity_id: "act_badge1",
      identity_id: "id_player1",
      snapshot_id: "snap_20260515",
      badge_family_id: "mongolian-petroglyph",
      merkle_proof: ["0xabcdef", "0x123456"],
    });
    expect(v.snapshot_id).toBe("snap_20260515");
    expect("event_id" in v).toBe(false);
  });

  it("RaffleDrawnPreimage decodes with winners + PRNG tier", () => {
    const v = Schema.decodeUnknownSync(RaffleDrawnPreimage)({
      ...baseEnvelope,
      $id: "https://schemas.freeside.thj/raffle-drawn/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/raffle-drawn/v1.0.0",
      activity_id: "act_raffle1",
      cycle_id: "cyc_2026-q2",
      winners: [{ identity_id: "id_winner1", tickets: 5 }],
      prng_seed: "f".repeat(64),
      prng_tier: "TIER-1",
    });
    expect(v.winners.length).toBe(1);
    expect(v.prng_tier).toBe("TIER-1");
  });

  it("RaffleDrawnPreimage rejects unknown prng_tier", () => {
    expectFail(RaffleDrawnPreimage, {
      ...baseEnvelope,
      $id: "https://schemas.freeside.thj/raffle-drawn/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/raffle-drawn/v1.0.0",
      activity_id: "act_raffle1",
      cycle_id: "cyc_2026-q2",
      winners: [],
      prng_seed: "f".repeat(64),
      prng_tier: "TIER-4",
    });
  });

  it("ProgressAdvancedPreimage decodes with version_before/after counters", () => {
    const v = Schema.decodeUnknownSync(ProgressAdvancedPreimage)({
      ...baseEnvelope,
      $id: "https://schemas.freeside.thj/progress-advanced/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/progress-advanced/v1.0.0",
      activity_id: "act_quest1",
      identity_id: "id_player1",
      new_step_completions: [],
      version_before: 0,
      version_after: 1,
    });
    expect(v.version_after).toBe(1);
  });
});

describe("Reward preimage schemas (CL-Reward-2)", () => {
  const rewardBase = {
    ...baseEnvelope,
    originating_event_id: ZERO_HASH,
    recipient: "id_player1",
  };

  it("RewardPendingPreimage decodes with reward_intent + attempts", () => {
    const v = Schema.decodeUnknownSync(RewardPendingPreimage)({
      ...rewardBase,
      $id: "https://schemas.freeside.thj/reward-pending/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/reward-pending/v1.0.0",
      reward_intent: { _tag: "None" },
      attempts: 0,
    });
    expect(v.attempts).toBe(0);
    expect("event_id" in v).toBe(false);
  });

  it("RewardGrantedPreimage decodes", () => {
    const v = Schema.decodeUnknownSync(RewardGrantedPreimage)({
      ...rewardBase,
      $id: "https://schemas.freeside.thj/reward-granted/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/reward-granted/v1.0.0",
      reward: { _tag: "None" },
    });
    expect(v.recipient).toBe("id_player1");
  });

  it("RewardFailedPreimage decodes with retryable flag", () => {
    const v = Schema.decodeUnknownSync(RewardFailedPreimage)({
      ...rewardBase,
      $id: "https://schemas.freeside.thj/reward-failed/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/reward-failed/v1.0.0",
      reward_intent: { _tag: "None" },
      failure_reason: "RPC timeout",
      retryable: true,
    });
    expect(v.retryable).toBe(true);
  });
});
