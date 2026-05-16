import { Either, ParseResult, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ActivityReward, RewardState } from "./index.js";

const expectFail = <A, I>(schema: Schema.Schema<A, I>, input: unknown) => {
  const result = Schema.decodeUnknownEither(schema)(input);
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isLeft(result)) {
    expect(ParseResult.isParseError(result.left)).toBe(true);
  }
};

const EVENT_ID_A = "a".repeat(64);
const EVENT_ID_B = "b".repeat(64);
const VALID_TS = "2026-05-15T12:34:56Z";

describe("ActivityReward · variant golden tests (FR-4 · CL-Reward-1)", () => {
  it("BadgeMint decodes with MintIntentId", () => {
    const v = Schema.decodeUnknownSync(ActivityReward)({
      _tag: "BadgeMint",
      mint_intent_id: "mint_intent001",
    });
    expect(v._tag).toBe("BadgeMint");
  });

  it("TokenAmount decodes with TokenId + DecimalValue (1 ETH equivalent)", () => {
    const v = Schema.decodeUnknownSync(ActivityReward)({
      _tag: "TokenAmount",
      token_id: "honey",
      amount: { value: "1000000000000000000", decimals: 18 },
    });
    expect(v._tag).toBe("TokenAmount");
    if (v._tag === "TokenAmount") {
      expect(v.amount.decimals).toBe(18);
    }
  });

  it("TokenAmount rejects bare numeric amount (must be DecimalValue struct)", () => {
    expectFail(ActivityReward, {
      _tag: "TokenAmount",
      token_id: "honey",
      amount: 1_000_000_000_000_000_000,
    });
  });

  it("Resource decodes with resource_kind + non-negative amount", () => {
    const v = Schema.decodeUnknownSync(ActivityReward)({
      _tag: "Resource",
      resource_kind: "wood",
      amount: 50,
    });
    expect(v._tag).toBe("Resource");
  });

  it("Resource rejects negative amount", () => {
    expectFail(ActivityReward, {
      _tag: "Resource",
      resource_kind: "wood",
      amount: -1,
    });
  });

  it("Cosmetic decodes with CosmeticId", () => {
    const v = Schema.decodeUnknownSync(ActivityReward)({
      _tag: "Cosmetic",
      cosmetic_id: "honey-hat",
    });
    expect(v._tag).toBe("Cosmetic");
  });

  it("External decodes with https uri + claim_proof", () => {
    const v = Schema.decodeUnknownSync(ActivityReward)({
      _tag: "External",
      reward_uri: "https://rewards.example.com/claim/123",
      claim_proof: "sig:abc123",
    });
    expect(v._tag).toBe("External");
  });

  it("External rejects non-http reward_uri", () => {
    expectFail(ActivityReward, {
      _tag: "External",
      reward_uri: "ftp://rewards.example.com",
      claim_proof: "sig",
    });
  });

  it("None decodes as the narrative-only reward variant", () => {
    const v = Schema.decodeUnknownSync(ActivityReward)({ _tag: "None" });
    expect(v._tag).toBe("None");
  });

  it("rejects unknown _tag (sealed union discipline)", () => {
    expectFail(ActivityReward, { _tag: "Mystery", value: 1 });
  });
});

describe("RewardState · async machine (FR-4.1 · CL-Reward-2..3)", () => {
  const pendingPayload = {
    _tag: "RewardPending",
    reward_intent: {
      _tag: "TokenAmount",
      token_id: "honey",
      amount: { value: "100", decimals: 0 },
    },
    originating_event_id: EVENT_ID_A,
    attempts: 0,
  };

  it("RewardPending decodes with attempts counter", () => {
    const v = Schema.decodeUnknownSync(RewardState)(pendingPayload);
    expect(v._tag).toBe("RewardPending");
    if (v._tag === "RewardPending") {
      expect(v.attempts).toBe(0);
    }
  });

  it("RewardPending rejects negative attempts", () => {
    expectFail(RewardState, { ...pendingPayload, attempts: -1 });
  });

  it("RewardGranted decodes with originating + granted event_ids and ts", () => {
    const v = Schema.decodeUnknownSync(RewardState)({
      _tag: "RewardGranted",
      reward: { _tag: "None" },
      originating_event_id: EVENT_ID_A,
      granted_event_id: EVENT_ID_B,
      ts: VALID_TS,
    });
    expect(v._tag).toBe("RewardGranted");
  });

  it("RewardGranted rejects when granted_event_id is malformed", () => {
    expectFail(RewardState, {
      _tag: "RewardGranted",
      reward: { _tag: "None" },
      originating_event_id: EVENT_ID_A,
      granted_event_id: "deadbeef",
      ts: VALID_TS,
    });
  });

  it("RewardFailed decodes with retryable=true", () => {
    const v = Schema.decodeUnknownSync(RewardState)({
      _tag: "RewardFailed",
      reward_intent: { _tag: "None" },
      originating_event_id: EVENT_ID_A,
      failure_reason: "RPC timeout",
      ts: VALID_TS,
      retryable: true,
    });
    expect(v._tag).toBe("RewardFailed");
  });

  it("RewardFailed decodes with retryable=false (terminal)", () => {
    const v = Schema.decodeUnknownSync(RewardState)({
      _tag: "RewardFailed",
      reward_intent: { _tag: "None" },
      originating_event_id: EVENT_ID_A,
      failure_reason: "invariant violation",
      ts: VALID_TS,
      retryable: false,
    });
    if (v._tag === "RewardFailed") {
      expect(v.retryable).toBe(false);
    }
  });

  it("RewardFailed rejects when failure_reason is empty", () => {
    expectFail(RewardState, {
      _tag: "RewardFailed",
      reward_intent: { _tag: "None" },
      originating_event_id: EVENT_ID_A,
      failure_reason: "",
      ts: VALID_TS,
      retryable: false,
    });
  });

  it("rejects RewardGranted with non-RFC3339 ts", () => {
    expectFail(RewardState, {
      _tag: "RewardGranted",
      reward: { _tag: "None" },
      originating_event_id: EVENT_ID_A,
      granted_event_id: EVENT_ID_B,
      ts: "2026-05-15",
    });
  });

  it("rejects unknown _tag (sealed state machine)", () => {
    expectFail(RewardState, {
      _tag: "RewardOverridden",
      reward: { _tag: "None" },
      originating_event_id: EVENT_ID_A,
    });
  });
});
