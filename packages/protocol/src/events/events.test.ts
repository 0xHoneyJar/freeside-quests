import { Effect, Either, ParseResult, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ActivityCompleted,
  BadgeIssued,
  computeEventId,
  computeEventIdSync,
  EventEnvelope,
  isMutatingEvent,
  NonceRequired,
  ProgressAdvanced,
  RaffleDrawn,
  RewardFailedEvent,
  RewardGrantedEvent,
  RewardPendingEvent,
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
const ACTIVITY_SCHEMA = "https://schemas.freeside.thj/activity-completed/v1.0.0";
const ACTIVITY_PREIMAGE_SCHEMA = "https://schemas.freeside.thj/preimage/activity-completed/v1.0.0";

const baseEnvelope = {
  event_id: ZERO_HASH,
  preimage_schema_id: "https://schemas.freeside.thj/preimage/some/v1.0.0",
  ts: VALID_TS,
  source_event_hash: null,
  nonce: null,
  schema_version: "1.0.0" as const,
  $id: "https://schemas.freeside.thj/some/v1.0.0",
};

describe("EventEnvelope (FR-5 common shape)", () => {
  it("decodes the canonical shape", () => {
    const v = Schema.decodeUnknownSync(EventEnvelope)(baseEnvelope);
    expect(v.event_id).toBe(ZERO_HASH);
    expect(v.schema_version).toBe("1.0.0");
  });

  it("rejects malformed event_id (must be 64-hex SHA-256)", () => {
    expectFail(EventEnvelope, { ...baseEnvelope, event_id: "deadbeef" });
  });

  it("rejects non-RFC3339 ts", () => {
    expectFail(EventEnvelope, { ...baseEnvelope, ts: "2026-05-15" });
  });

  it("rejects schema_version not equal to literal '1.0.0'", () => {
    expectFail(EventEnvelope, { ...baseEnvelope, schema_version: "2.0.0" });
  });

  it("accepts null source_event_hash (root event)", () => {
    const v = Schema.decodeUnknownSync(EventEnvelope)({
      ...baseEnvelope,
      source_event_hash: null,
    });
    expect(v.source_event_hash).toBeNull();
  });

  it("accepts a valid hash for source_event_hash (chained event)", () => {
    const v = Schema.decodeUnknownSync(EventEnvelope)({
      ...baseEnvelope,
      source_event_hash: SAMPLE_HASH,
    });
    expect(v.source_event_hash).toBe(SAMPLE_HASH);
  });
});

describe("ActivityCompleted (FR-5 · per PRD §FR-5)", () => {
  const validPayload = {
    ...baseEnvelope,
    $id: ACTIVITY_SCHEMA,
    preimage_schema_id: ACTIVITY_PREIMAGE_SCHEMA,
    activity_id: "act_quest1",
    identity_id: "id_player001",
    period_key: null,
    step_completions: [],
    reward_state_id: null,
  };

  it("decodes a minimal ActivityCompleted (golden)", () => {
    const v = Schema.decodeUnknownSync(ActivityCompleted)(validPayload);
    expect(v.activity_id).toBe("act_quest1");
  });

  it("rejects $id pointing to a different event type", () => {
    expectFail(ActivityCompleted, {
      ...validPayload,
      $id: "https://schemas.freeside.thj/badge-issued/v1.0.0",
    });
  });

  it("rejects malformed activity_id", () => {
    expectFail(ActivityCompleted, { ...validPayload, activity_id: "quest1" });
  });
});

describe("BadgeIssued / RaffleDrawn / ProgressAdvanced golden decodes", () => {
  it("BadgeIssued decodes with merkle proof + snapshot binding", () => {
    const v = Schema.decodeUnknownSync(BadgeIssued)({
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
  });

  it("RaffleDrawn decodes with winners + PRNG tier", () => {
    const v = Schema.decodeUnknownSync(RaffleDrawn)({
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
  });

  it("RaffleDrawn rejects unknown prng_tier", () => {
    expectFail(RaffleDrawn, {
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

  it("ProgressAdvanced decodes with version_before/after counters", () => {
    const v = Schema.decodeUnknownSync(ProgressAdvanced)({
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

describe("Reward events (CL-Reward-2)", () => {
  const rewardBase = {
    ...baseEnvelope,
    originating_event_id: ZERO_HASH,
    recipient: "id_player1",
  };

  it("RewardPendingEvent decodes with reward_intent + attempts", () => {
    const v = Schema.decodeUnknownSync(RewardPendingEvent)({
      ...rewardBase,
      $id: "https://schemas.freeside.thj/reward-pending/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/reward-pending/v1.0.0",
      reward_intent: { _tag: "None" },
      attempts: 0,
    });
    expect(v.attempts).toBe(0);
  });

  it("RewardGrantedEvent decodes", () => {
    const v = Schema.decodeUnknownSync(RewardGrantedEvent)({
      ...rewardBase,
      $id: "https://schemas.freeside.thj/reward-granted/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/reward-granted/v1.0.0",
      reward: { _tag: "None" },
    });
    expect(v.recipient).toBe("id_player1");
    expect(v.reward._tag).toBe("None");
  });

  it("RewardFailedEvent decodes with retryable flag", () => {
    const v = Schema.decodeUnknownSync(RewardFailedEvent)({
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

describe("isMutatingEvent (Fix-A1)", () => {
  it("identifies activity-completed as mutating", () => {
    expect(isMutatingEvent({ $id: "https://schemas.freeside.thj/activity-completed/v1.0.0" })).toBe(
      true,
    );
  });
  it("identifies badge-issued as mutating", () => {
    expect(isMutatingEvent({ $id: "https://schemas.freeside.thj/badge-issued/v1.0.0" })).toBe(true);
  });
  it("identifies raffle-drawn as mutating", () => {
    expect(isMutatingEvent({ $id: "https://schemas.freeside.thj/raffle-drawn/v1.0.0" })).toBe(true);
  });
  it("identifies progress-advanced as mutating", () => {
    expect(isMutatingEvent({ $id: "https://schemas.freeside.thj/progress-advanced/v1.0.0" })).toBe(
      true,
    );
  });
  it("identifies reward-pending as mutating", () => {
    expect(isMutatingEvent({ $id: "https://schemas.freeside.thj/reward-pending/v1.0.0" })).toBe(
      true,
    );
  });
  it("identifies reward-granted as non-mutating", () => {
    expect(isMutatingEvent({ $id: "https://schemas.freeside.thj/reward-granted/v1.0.0" })).toBe(
      false,
    );
  });
  it("identifies reward-failed as non-mutating", () => {
    expect(isMutatingEvent({ $id: "https://schemas.freeside.thj/reward-failed/v1.0.0" })).toBe(
      false,
    );
  });
});

describe("computeEventId (Fix-A1 nonce policy · §5.6 hash-determinism)", () => {
  const mutatingEvent = {
    $id: "https://schemas.freeside.thj/activity-completed/v1.0.0",
    preimage_schema_id: "https://schemas.freeside.thj/preimage/activity-completed/v1.0.0",
    ts: VALID_TS,
    source_event_hash: null,
    schema_version: "1.0.0",
    activity_id: "act_quest1",
    identity_id: "id_player1",
    period_key: null,
    step_completions: [],
    reward_state_id: null,
  };

  it("fails with NonceRequired when mutating event has null nonce", async () => {
    const result = await Effect.runPromiseExit(
      computeEventId({ ...mutatingEvent, event_id: ZERO_HASH, nonce: null }),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure" && result.cause._tag === "Fail") {
      expect(result.cause.error._tag).toBe("NonceRequired");
    }
  });

  it("succeeds when mutating event has a caller-supplied nonce", async () => {
    const hash = await computeEventIdSync({
      ...mutatingEvent,
      event_id: ZERO_HASH,
      nonce: "caller-supplied-abc",
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic across 100 invocations of the same input (CL-Event-3)", async () => {
    const ref = await computeEventIdSync({
      ...mutatingEvent,
      event_id: ZERO_HASH,
      nonce: "deterministic-test",
    });
    for (let i = 0; i < 100; i++) {
      const again = await computeEventIdSync({
        ...mutatingEvent,
        event_id: ZERO_HASH,
        nonce: "deterministic-test",
      });
      expect(again).toBe(ref);
    }
  });

  it("collision-distinguishes via nonce (CL-Event-5)", async () => {
    const a = await computeEventIdSync({
      ...mutatingEvent,
      event_id: ZERO_HASH,
      nonce: "first",
    });
    const b = await computeEventIdSync({
      ...mutatingEvent,
      event_id: ZERO_HASH,
      nonce: "second",
    });
    expect(a).not.toBe(b);
  });

  it("excludes the event_id field from the preimage (§5.6)", async () => {
    const a = await computeEventIdSync({
      ...mutatingEvent,
      event_id: ZERO_HASH,
      nonce: "x",
    });
    const b = await computeEventIdSync({
      ...mutatingEvent,
      event_id: SAMPLE_HASH, // different event_id, same preimage everything else
      nonce: "x",
    });
    expect(a).toBe(b);
  });

  it("sorts step_completions by (order, step_id) before hashing (§5.6 tie-break)", async () => {
    const completions = [
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
    ];
    const reversed = [...completions].reverse();
    const a = await computeEventIdSync({
      ...mutatingEvent,
      event_id: ZERO_HASH,
      nonce: "z",
      step_completions: completions,
    });
    const b = await computeEventIdSync({
      ...mutatingEvent,
      event_id: ZERO_HASH,
      nonce: "z",
      step_completions: reversed,
    });
    expect(a).toBe(b); // canonical sort makes ordering irrelevant
  });

  it("succeeds without nonce when event is non-mutating (RewardGranted)", async () => {
    const hash = await computeEventIdSync({
      $id: "https://schemas.freeside.thj/reward-granted/v1.0.0",
      event_id: ZERO_HASH,
      preimage_schema_id: "https://schemas.freeside.thj/preimage/reward-granted/v1.0.0",
      ts: VALID_TS,
      source_event_hash: null,
      nonce: null,
      schema_version: "1.0.0",
      originating_event_id: ZERO_HASH,
      recipient: "id_player1",
      reward: { _tag: "None" },
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("NonceRequired error carries event_type field for caller debugging", async () => {
    const result = await Effect.runPromiseExit(
      computeEventId({ ...mutatingEvent, event_id: ZERO_HASH, nonce: null }),
    );
    if (result._tag === "Failure" && result.cause._tag === "Fail") {
      const err = result.cause.error;
      if (err._tag === "NonceRequired") {
        expect(err.event_type).toBe(mutatingEvent.$id);
      } else {
        throw new Error("expected NonceRequired");
      }
    }
  });
});

describe("EventError sealed union", () => {
  it("NonceRequired decodes as a sealed-union member", () => {
    const v = Schema.decodeUnknownSync(NonceRequired)({
      _tag: "NonceRequired",
      event_type: "https://x",
      reason: "missing nonce",
    });
    expect(v._tag).toBe("NonceRequired");
  });
});
