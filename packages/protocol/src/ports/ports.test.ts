import { Either, ParseResult, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { PartitionKey } from "../branded/PartitionKey.js";
import {
  AppendOptions,
  ChainAddress,
  EventFilter,
  IdentityResolverError,
  ProgressError,
  ProgressLifecycleState,
  ProgressRecord,
  RewardError,
  TipDescriptor,
} from "./index.js";

const expectFail = <A, I>(schema: Schema.Schema<A, I>, input: unknown) => {
  const result = Schema.decodeUnknownEither(schema)(input);
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isLeft(result)) {
    expect(ParseResult.isParseError(result.left)).toBe(true);
  }
};

const ZERO_HASH = "0".repeat(64);

describe("ProgressRecord (T1.15 · D10 · §3.2)", () => {
  const validRecord = {
    activity_id: "act_quest1",
    identity_id: "id_player1",
    current_step: null,
    steps_completed: [],
    last_advanced_event_id: null,
    version: 0,
    lifecycle_state: "NOT_STARTED" as const,
  };

  it("decodes a clean NOT_STARTED record", () => {
    const v = Schema.decodeUnknownSync(ProgressRecord)(validRecord);
    expect(v.lifecycle_state).toBe("NOT_STARTED");
  });

  it("decodes an IN_PROGRESS record with a current_step", () => {
    const v = Schema.decodeUnknownSync(ProgressRecord)({
      ...validRecord,
      current_step: "step_intro-1",
      lifecycle_state: "IN_PROGRESS",
      version: 1,
    });
    expect(v.current_step).toBe("step_intro-1");
  });

  it("decodes a COMPLETED record with last_advanced_event_id", () => {
    const v = Schema.decodeUnknownSync(ProgressRecord)({
      ...validRecord,
      last_advanced_event_id: ZERO_HASH,
      lifecycle_state: "COMPLETED",
      version: 5,
    });
    expect(v.lifecycle_state).toBe("COMPLETED");
  });

  it("rejects unknown lifecycle_state value (sealed literal union)", () => {
    expectFail(ProgressRecord, { ...validRecord, lifecycle_state: "ARCHIVED" });
  });

  it("rejects negative version (optimistic-concurrency counter)", () => {
    expectFail(ProgressRecord, { ...validRecord, version: -1 });
  });

  it("rejects non-integer version", () => {
    expectFail(ProgressRecord, { ...validRecord, version: 1.5 });
  });

  it("ProgressLifecycleState exports the 3 states", () => {
    for (const state of ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]) {
      const decoded = Schema.decodeUnknownSync(ProgressLifecycleState)(state);
      expect(decoded).toBe(state);
    }
  });
});

describe("ProgressError sealed union (FR-8)", () => {
  it("decodes ActivityNotFound with activity_id", () => {
    const v = Schema.decodeUnknownSync(ProgressError)({
      _tag: "ActivityNotFound",
      activity_id: "act_x",
    });
    expect(v._tag).toBe("ActivityNotFound");
  });

  it("decodes ConcurrentUpdate with version diff (D10 optimistic concurrency)", () => {
    const v = Schema.decodeUnknownSync(ProgressError)({
      _tag: "ConcurrentUpdate",
      activity_id: "act_x",
      current_version: 5,
      attempted_version: 3,
    });
    expect(v._tag).toBe("ConcurrentUpdate");
    if (v._tag === "ConcurrentUpdate") {
      expect(v.current_version).toBeGreaterThan(v.attempted_version);
    }
  });

  it("decodes AdapterUnavailable", () => {
    const v = Schema.decodeUnknownSync(ProgressError)({
      _tag: "AdapterUnavailable",
      adapter_id: "postgres-prod",
      reason: "connection reset",
    });
    expect(v._tag).toBe("AdapterUnavailable");
  });

  it("rejects unknown _tag", () => {
    expectFail(ProgressError, { _tag: "MysteryError" });
  });
});

describe("RewardError sealed union (FR-8 · D18)", () => {
  it("decodes AlreadyGranted (D18 idempotency hit)", () => {
    const v = Schema.decodeUnknownSync(RewardError)({
      _tag: "AlreadyGranted",
      originating_event_id: ZERO_HASH,
      existing_grant_id: "a".repeat(64),
    });
    expect(v._tag).toBe("AlreadyGranted");
  });

  it("decodes GrantFailed with retryable=true (FR-4.2 path)", () => {
    const v = Schema.decodeUnknownSync(RewardError)({
      _tag: "GrantFailed",
      reward_intent: { _tag: "None" },
      reason: "RPC timeout",
      retryable: true,
    });
    expect(v._tag).toBe("GrantFailed");
  });

  it("decodes IdentityUnresolvable", () => {
    const v = Schema.decodeUnknownSync(RewardError)({
      _tag: "IdentityUnresolvable",
      identity_id: "id_player1",
    });
    expect(v._tag).toBe("IdentityUnresolvable");
  });
});

describe("IdentityResolverError + ChainAddress (FR-8 · CL-Identity-3..4)", () => {
  it("ChainAddress decodes a non-empty bounded string", () => {
    const v = Schema.decodeUnknownSync(ChainAddress)("0x1234567890abcdef1234567890abcdef12345678");
    expect(typeof v).toBe("string");
  });

  it("ChainAddress rejects empty string", () => {
    expectFail(ChainAddress, "");
  });

  it("IdentityResolverError UnresolvableIdentity decodes", () => {
    const v = Schema.decodeUnknownSync(IdentityResolverError)({
      _tag: "UnresolvableIdentity",
      identity_id: "id_player1",
    });
    expect(v._tag).toBe("UnresolvableIdentity");
  });

  it("IdentityResolverError ChainNotSupported decodes", () => {
    const v = Schema.decodeUnknownSync(IdentityResolverError)({
      _tag: "ChainNotSupported",
      chain: "tron",
    });
    expect(v._tag).toBe("ChainNotSupported");
  });
});

describe("EventStoreContract types (FR-11 · §4.2)", () => {
  it("AppendOptions decodes with null expected_tip_hash (initial append)", () => {
    const v = Schema.decodeUnknownSync(AppendOptions)({
      partition_key: { scope: "activity", value: "act_x" },
      expected_tip_hash: null,
    });
    expect(v.expected_tip_hash).toBeNull();
  });

  it("AppendOptions decodes with concrete expected_tip_hash (CAS)", () => {
    const v = Schema.decodeUnknownSync(AppendOptions)({
      partition_key: { scope: "activity", value: "act_x" },
      expected_tip_hash: ZERO_HASH,
    });
    expect(v.expected_tip_hash).toBe(ZERO_HASH);
  });

  it("TipDescriptor decodes with monotonic_sequence", () => {
    const v = Schema.decodeUnknownSync(TipDescriptor)({
      partition_key: { scope: "activity", value: "act_x" },
      tip_event_id: ZERO_HASH,
      monotonic_sequence: 42,
    });
    expect(v.monotonic_sequence).toBe(42);
  });

  it("TipDescriptor rejects negative monotonic_sequence", () => {
    expectFail(TipDescriptor, {
      partition_key: { scope: "activity", value: "act_x" },
      tip_event_id: null,
      monotonic_sequence: -1,
    });
  });
});

describe("EventFilter (CompletionEventPort.query)", () => {
  it("decodes an empty filter (all events)", () => {
    const v = Schema.decodeUnknownSync(EventFilter)({});
    expect(v).toEqual({});
  });

  it("decodes a full filter", () => {
    const v = Schema.decodeUnknownSync(EventFilter)({
      activity_id: "act_x",
      identity_id: "id_y",
      source_event_hash: null,
      ts_after: "2026-05-01T00:00:00Z",
      ts_before: "2026-06-01T00:00:00Z",
      limit: 100,
    });
    expect(v.limit).toBe(100);
  });

  it("rejects limit out of range", () => {
    expectFail(EventFilter, { limit: 0 });
    expectFail(EventFilter, { limit: 10001 });
  });

  it("rejects malformed ts_after", () => {
    expectFail(EventFilter, { ts_after: "2026-05-01" });
  });
});

describe("PartitionKey composite validator (T1.20 · IMP-016)", () => {
  it("accepts well-formed composite values", () => {
    const valid = ["world_mongolian::act_quest1", "id_player::act_x", "scope_a::scope_b"];
    for (const value of valid) {
      const v = Schema.decodeUnknownSync(PartitionKey)({
        scope: "composite",
        value,
      });
      expect(v.value).toBe(value);
    }
  });

  it("rejects composite values missing the :: separator", () => {
    expectFail(PartitionKey, { scope: "composite", value: "no-separator" });
  });

  it("rejects composite values starting with a digit", () => {
    expectFail(PartitionKey, { scope: "composite", value: "1abc::xyz" });
  });

  it("rejects composite halves longer than 120 chars", () => {
    const bad = `${"x".repeat(121)}::${"y".repeat(10)}`;
    expectFail(PartitionKey, { scope: "composite", value: bad });
  });

  it("non-composite scopes accept free-form values (T1.20 doesn't constrain them)", () => {
    const v = Schema.decodeUnknownSync(PartitionKey)({
      scope: "activity",
      value: "act_anything",
    });
    expect(v.value).toBe("act_anything");
  });
});
