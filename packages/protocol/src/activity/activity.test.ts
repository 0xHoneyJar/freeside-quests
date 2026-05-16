import { Either, ParseResult, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  Activity,
  ActivityKind,
  ActivityLifecycleState,
  RESERVED_KIND_PREFIXES,
  WorldDefinedKindId,
} from "./index.js";

/**
 * T1.3 + T1.4 acceptance test suite.
 *
 * T1.3 — Activity schema (FR-1 · CL-Activity-1..4):
 *   - golden test for each kind (Quest, Mission, BadgeClaim, RaffleEntry, WorldDefined)
 *   - WorldDefined valid
 *   - cross-kind reject (wrong period_key shape for the kind)
 *   - compass-roundtrip + cubquests-roundtrip placeholders
 *
 * T1.4 — WorldDefined seam (D19 · §9.1):
 *   - reserved prefix → schema error
 *   - invalid format → schema error
 *   - valid registers cleanly
 */

const COMPLETION_EVENT_SCHEMA_ID = "https://schemas.freeside.thj/activity-completed/v1.0.0";
const ACTIVITY_SCHEMA_ID = "https://schemas.freeside.thj/activity/v1.0.0";
const SUB_SCHEMA_ID = "https://schemas.world-purupuru.example/kinds/puruhani-bond-day-7";

const baseActivity = {
  id: "act_quest1",
  period_key: null,
  steps: [],
  reward: { _tag: "None" },
  reward_state_id: null,
  completion_event_schema: COMPLETION_EVENT_SCHEMA_ID,
  world: null,
  schema_version: "1.0.0" as const,
  lifecycle_state: "DEFINED" as const,
  $id: ACTIVITY_SCHEMA_ID as typeof ACTIVITY_SCHEMA_ID,
};

const decodeActivity = (raw: unknown) => Schema.decodeUnknownEither(Activity)(raw);

const decodeActivityOrThrow = (raw: unknown) => Schema.decodeUnknownSync(Activity)(raw);

const assertFails = (input: unknown) => {
  const result = decodeActivity(input);
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isLeft(result)) {
    expect(ParseResult.isParseError(result.left)).toBe(true);
  }
};

describe("ActivityLifecycleState", () => {
  it("accepts every declared lifecycle state (CL-Activity-4)", () => {
    const states = ["DEFINED", "ACTIVE", "PARTICIPATING", "COMPLETED", "EXPIRED"] as const;
    for (const state of states) {
      const decoded = Schema.decodeUnknownSync(ActivityLifecycleState)(state);
      expect(decoded).toBe(state);
    }
  });

  it("rejects out-of-union lifecycle values", () => {
    for (const v of ["draft", "active", "completed", "DEFINED ", "ARCHIVED", null, 0]) {
      const result = Schema.decodeUnknownEither(ActivityLifecycleState)(v);
      expect(Either.isLeft(result)).toBe(true);
    }
  });
});

describe("Activity · Quest kind (period_key: null · golden)", () => {
  it("decodes a minimal Quest activity (FR-2 source-of-truth: cubquests user_activity_progress)", () => {
    const quest = decodeActivityOrThrow({
      ...baseActivity,
      kind: { _tag: "Quest", period_key: null },
    });
    expect(quest.kind._tag).toBe("Quest");
    expect(quest.lifecycle_state).toBe("DEFINED");
  });

  it("rejects a Quest activity with a non-null kind.period_key (CL-Activity-3 cross-kind reject)", () => {
    assertFails({
      ...baseActivity,
      kind: { _tag: "Quest", period_key: "2025-W42" },
    });
  });
});

describe("Activity · Mission kind (period_key: ISOWeek · golden)", () => {
  it("decodes a Mission activity with a valid ISO-week period_key", () => {
    const mission = decodeActivityOrThrow({
      ...baseActivity,
      kind: { _tag: "Mission", period_key: "2025-W42" },
    });
    expect(mission.kind._tag).toBe("Mission");
  });

  it("accepts each valid ISO-week within the 01..53 range", () => {
    for (const week of ["2026-W01", "2026-W52", "2026-W53"]) {
      const v = decodeActivityOrThrow({
        ...baseActivity,
        kind: { _tag: "Mission", period_key: week },
      });
      expect(v.kind._tag).toBe("Mission");
    }
  });

  it("rejects malformed ISO-week patterns (cross-kind boundary)", () => {
    for (const bad of ["2026", "2026-42", "2026-W00", "2026-W54", "26-W42", "null"]) {
      assertFails({
        ...baseActivity,
        kind: { _tag: "Mission", period_key: bad },
      });
    }
  });
});

describe("Activity · BadgeClaim kind (period_key: null | SnapshotId · golden)", () => {
  it("decodes with null period_key (one-shot badge)", () => {
    const v = decodeActivityOrThrow({
      ...baseActivity,
      kind: { _tag: "BadgeClaim", period_key: null },
    });
    expect(v.kind._tag).toBe("BadgeClaim");
  });

  it("decodes with a SnapshotId period_key (merkle-bound badge)", () => {
    const v = decodeActivityOrThrow({
      ...baseActivity,
      kind: { _tag: "BadgeClaim", period_key: "snap_20260515" },
    });
    expect(v.kind._tag).toBe("BadgeClaim");
  });

  it("rejects an ISOWeek-style period_key (cross-kind reject)", () => {
    assertFails({
      ...baseActivity,
      kind: { _tag: "BadgeClaim", period_key: "2026-W42" },
    });
  });
});

describe("Activity · RaffleEntry kind (period_key: CycleId · golden)", () => {
  it("decodes a RaffleEntry with a CycleId period_key", () => {
    const v = decodeActivityOrThrow({
      ...baseActivity,
      kind: { _tag: "RaffleEntry", period_key: "cyc_2026-q2" },
    });
    expect(v.kind._tag).toBe("RaffleEntry");
  });

  it("rejects null period_key for RaffleEntry (CL-Activity-3)", () => {
    assertFails({
      ...baseActivity,
      kind: { _tag: "RaffleEntry", period_key: null },
    });
  });

  it("rejects malformed CycleId for RaffleEntry", () => {
    assertFails({
      ...baseActivity,
      kind: { _tag: "RaffleEntry", period_key: "raffle-2026" },
    });
  });
});

describe("Activity · WorldDefined kind (FR-2 seam · §9.1 namespace · golden)", () => {
  const validWorldDefined = {
    _tag: "WorldDefined" as const,
    world_id: "world_purupuru",
    kind_id: "world_purupuru:puruhani-bond-day-7",
    sub_schema_id: SUB_SCHEMA_ID,
    period_key: null,
  };

  it("decodes a valid WorldDefined kind", () => {
    const v = decodeActivityOrThrow({
      ...baseActivity,
      kind: validWorldDefined,
    });
    expect(v.kind._tag).toBe("WorldDefined");
  });

  it("decodes a WorldDefined kind with a world-supplied period_key string", () => {
    const v = decodeActivityOrThrow({
      ...baseActivity,
      kind: {
        ...validWorldDefined,
        period_key: "world_purupuru:season-7-arc-2",
      },
    });
    expect(v.kind._tag).toBe("WorldDefined");
  });

  it("rejects WorldDefined with empty period_key string", () => {
    assertFails({
      ...baseActivity,
      kind: { ...validWorldDefined, period_key: "" },
    });
  });
});

describe("WorldDefinedKindId (T1.4 namespace governance · §9.1)", () => {
  const decode = Schema.decodeUnknownEither(WorldDefinedKindId);

  it("accepts well-formed `<world_id>:<kind>` ids", () => {
    const valid = [
      "world_purupuru:puruhani-bond-day-7",
      "world_mibera:grail-veneration",
      "world_a:b",
      "world_with_underscores:kind-with-dashes",
      "w:k",
    ];
    for (const v of valid) {
      const result = decode(v);
      expect(Either.isRight(result)).toBe(true);
    }
  });

  it("rejects ids longer than 64 chars", () => {
    const too_long = `${"x".repeat(33)}:${"y".repeat(32)}`; // 33+1+32 = 66
    expect(too_long.length).toBe(66);
    const result = decode(too_long);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects ids missing the colon delimiter", () => {
    for (const bad of ["world_purupurupuruhani", "no-colon-here", "world_a:", ":kind"]) {
      const result = decode(bad);
      expect(Either.isLeft(result)).toBe(true);
    }
  });

  it("rejects uppercase, dots, or whitespace in either half", () => {
    for (const bad of [
      "World_purupuru:kind",
      "world_purupuru:Kind",
      "world.purupuru:kind",
      "world_purupuru:kind name",
    ]) {
      const result = decode(bad);
      expect(Either.isLeft(result)).toBe(true);
    }
  });

  it("rejects kind suffix starting with any RESERVED prefix (substrate ownership)", () => {
    for (const prefix of RESERVED_KIND_PREFIXES) {
      const bad = `world_a:${prefix}example`;
      const result = decode(bad);
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(ParseResult.isParseError(result.left)).toBe(true);
      }
    }
  });

  it("RESERVED_KIND_PREFIXES contains the documented prefixes", () => {
    expect(RESERVED_KIND_PREFIXES).toEqual(["freeside-", "loa-", "core-"]);
  });

  it("propagates kind_id validation through the ActivityKind union", () => {
    const result = Schema.decodeUnknownEither(ActivityKind)({
      _tag: "WorldDefined",
      world_id: "world_purupuru",
      kind_id: "world_purupuru:freeside-leak", // reserved suffix
      sub_schema_id: SUB_SCHEMA_ID,
      period_key: null,
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("Activity · canonical scaffold (CL-Activity-1 JCS-readiness)", () => {
  it("rejects when $id is altered (sealed authorship identifier)", () => {
    assertFails({
      ...baseActivity,
      kind: { _tag: "Quest", period_key: null },
      $id: "https://example.org/spoofed/v1.0.0",
    });
  });

  it("rejects when schema_version is bumped without an explicit migration", () => {
    assertFails({
      ...baseActivity,
      kind: { _tag: "Quest", period_key: null },
      schema_version: "2.0.0",
    });
  });

  it("rejects an unknown ActivityKind discriminator (exhaustive sealed union)", () => {
    assertFails({
      ...baseActivity,
      kind: { _tag: "MysteryKind", period_key: null },
    });
  });

  it("rejects when completion_event_schema is not an https URL", () => {
    assertFails({
      ...baseActivity,
      kind: { _tag: "Quest", period_key: null },
      completion_event_schema: "not-a-url",
    });
  });

  it("accepts an Activity bound to a specific world", () => {
    const v = decodeActivityOrThrow({
      ...baseActivity,
      kind: { _tag: "Quest", period_key: null },
      world: "world_mongolian",
    });
    expect(v.world).toBe("world_mongolian");
  });

  it("rejects an Activity with a malformed WorldId binding", () => {
    assertFails({
      ...baseActivity,
      kind: { _tag: "Quest", period_key: null },
      world: "mongolian", // missing world_ prefix
    });
  });
});

describe("Cross-runtime roundtrip placeholders (T1.3 acceptance criterion)", () => {
  it("compass-roundtrip placeholder · Quest activity stable through encode/decode", () => {
    // Full conformance suite lives in compass; here we verify the protocol's
    // own encode/decode is byte-stable for the kind compass consumes (Quest).
    const raw = {
      ...baseActivity,
      kind: { _tag: "Quest", period_key: null },
    };
    const decoded = decodeActivityOrThrow(raw);
    const reencoded = Schema.encodeSync(Activity)(decoded);
    expect(reencoded).toEqual(raw);
  });

  it("cubquests-roundtrip placeholder · RaffleEntry activity stable through encode/decode", () => {
    // cubquests' resource_raffle_cycles maps onto RaffleEntry with CycleId
    const raw = {
      ...baseActivity,
      kind: { _tag: "RaffleEntry", period_key: "cyc_2026-q2" },
    };
    const decoded = decodeActivityOrThrow(raw);
    const reencoded = Schema.encodeSync(Activity)(decoded);
    expect(reencoded).toEqual(raw);
  });
});
