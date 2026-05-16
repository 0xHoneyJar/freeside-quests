/**
 * EventStoreContract conformance suite (FR-11 · CL-EventStore-1..7 + Fix-A1).
 *
 * This file is the canonical adapter conformance gate (SDD §4.2). Every
 * adapter that implements EventStoreContract MUST pass this suite. The
 * in-memory adapter is the reference implementation; postgres + convex
 * variants (world-built) re-run the same scenarios against their stores.
 */
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ActivityCompleted,
  ActivityId,
  computeEventIdSync,
  EventId,
  IdentityId,
  type PartitionKey,
  PartitionScope,
  ProgressAdvanced,
  RFC3339Date,
  StepId,
} from "@0xhoneyjar/quests-protocol";

import { makeInMemoryEventStore } from "../completion-event.js";

const decode = Schema.decodeUnknownSync;

// canonical test fixtures
const activityA = decode(ActivityId)("act_a");
const activityB = decode(ActivityId)("act_b");
const identityA = decode(IdentityId)("id_a");
const stepFoo = decode(StepId)("step_foo");
const ts0 = decode(RFC3339Date)("2026-05-16T00:00:00Z");
const ts1 = decode(RFC3339Date)("2026-05-16T00:01:00Z");
const ts2 = decode(RFC3339Date)("2026-05-16T00:02:00Z");

const partitionFor = (activityId: typeof activityA): PartitionKey =>
  ({ scope: "activity" as PartitionScope, value: activityId as unknown as string }) as PartitionKey;

const compositePartition = (a: string, b: string): PartitionKey =>
  ({ scope: "composite" as PartitionScope, value: `${a}::${b}` }) as PartitionKey;

/**
 * Builds an ActivityCompleted event with caller-supplied nonce + correct
 * canonical event_id. The test fixture exercises the full §5.6 hashing
 * pipeline so the assertions reflect production behavior.
 */
const buildActivityCompleted = async (overrides: {
  activityId?: typeof activityA;
  ts?: typeof ts0;
  nonce: string;
  sourceEventHash?: string | null;
}): Promise<ActivityCompleted> => {
  const draft = {
    event_id: "0000000000000000000000000000000000000000000000000000000000000000",
    preimage_schema_id: "https://schemas.freeside.thj/preimage/activity-completed/v1.0.0",
    ts: overrides.ts ?? ts0,
    source_event_hash: overrides.sourceEventHash ?? null,
    nonce: overrides.nonce,
    schema_version: "1.0.0" as const,
    $id: "https://schemas.freeside.thj/activity-completed/v1.0.0" as const,
    activity_id: overrides.activityId ?? activityA,
    identity_id: identityA,
    period_key: null,
    step_completions: [],
    reward_state_id: null,
  };
  const computed = await computeEventIdSync(draft as unknown as Record<string, unknown> & {
    $id: string;
    nonce: string | null;
  });
  return decode(ActivityCompleted)({ ...draft, event_id: computed });
};

const buildProgressAdvanced = async (overrides: {
  nonce: string | null;
  versionBefore?: number;
  versionAfter?: number;
}): Promise<ProgressAdvanced> => {
  const draft = {
    event_id: "0000000000000000000000000000000000000000000000000000000000000000",
    preimage_schema_id: "https://schemas.freeside.thj/preimage/progress-advanced/v1.0.0",
    ts: ts0,
    source_event_hash: null,
    nonce: overrides.nonce,
    schema_version: "1.0.0" as const,
    $id: "https://schemas.freeside.thj/progress-advanced/v1.0.0" as const,
    activity_id: activityA,
    identity_id: identityA,
    new_step_completions: [],
    version_before: overrides.versionBefore ?? 0,
    version_after: overrides.versionAfter ?? 1,
  };
  // For non-nonce events we let computeEventId reject (Fix-A1). The test
  // that exercises NonceRequired hand-builds the event with a placeholder
  // event_id (the adapter rejects before ever hashing).
  if (overrides.nonce === null) {
    return decode(ProgressAdvanced)({
      ...draft,
      event_id: "deadbeef".repeat(8),
    });
  }
  const computed = await computeEventIdSync(draft as unknown as Record<string, unknown> & {
    $id: string;
    nonce: string | null;
  });
  return decode(ProgressAdvanced)({ ...draft, event_id: computed });
};

describe("EventStoreContract conformance — in-memory adapter", () => {
  describe("CL-EventStore-1 + CL-EventStore-2 — append-only + monotonic-sequence", () => {
    it("appends N events and read returns them in monotonic-sequence order", async () => {
      const { contract } = makeInMemoryEventStore();
      const partition = partitionFor(activityA);
      const e1 = await buildActivityCompleted({ nonce: "n1" });
      const e2 = await buildActivityCompleted({ nonce: "n2", ts: ts1 });
      const e3 = await buildActivityCompleted({ nonce: "n3", ts: ts2 });

      const tip1 = await Effect.runPromise(
        contract.append(e1, { partition_key: partition, expected_tip_hash: null }),
      );
      expect(tip1.monotonic_sequence).toBe(1);
      expect(tip1.tip_event_id).toBe(e1.event_id);

      const tip2 = await Effect.runPromise(
        contract.append(e2, { partition_key: partition, expected_tip_hash: e1.event_id }),
      );
      expect(tip2.monotonic_sequence).toBe(2);

      const tip3 = await Effect.runPromise(
        contract.append(e3, { partition_key: partition, expected_tip_hash: e2.event_id }),
      );
      expect(tip3.monotonic_sequence).toBe(3);

      const read = await Effect.runPromise(contract.read(partition));
      expect(read.length).toBe(3);
      expect(read.map((e) => e.event_id)).toEqual([e1.event_id, e2.event_id, e3.event_id]);
    });

    it("getTip on empty partition returns null tip + sequence 0", async () => {
      const { contract } = makeInMemoryEventStore();
      const tip = await Effect.runPromise(contract.getTip(partitionFor(activityB)));
      expect(tip.tip_event_id).toBeNull();
      expect(tip.monotonic_sequence).toBe(0);
    });
  });

  describe("CL-EventStore-3 — CAS via expected_tip_hash", () => {
    it("rejects append with stale expected_tip_hash (concurrent-writer race)", async () => {
      const { contract } = makeInMemoryEventStore();
      const partition = partitionFor(activityA);
      const e1 = await buildActivityCompleted({ nonce: "n1" });
      const e2 = await buildActivityCompleted({ nonce: "n2", ts: ts1 });

      // first writer succeeds
      await Effect.runPromise(
        contract.append(e1, { partition_key: partition, expected_tip_hash: null }),
      );
      // second writer also thinks tip is null (stale view) → CASFailed
      const fail = await Effect.runPromise(
        Effect.flip(
          contract.append(e2, { partition_key: partition, expected_tip_hash: null }),
        ),
      );
      expect(fail._tag).toBe("CASFailed");
      // C4 fix: expected (0 for null tip) MUST differ from actual (1 after first append)
      if (fail._tag === "CASFailed") {
        expect(fail.expected_version).toBe(0);
        expect(fail.actual_version).toBe(1);
      }
    });

    it("CASFailed payload reconstructs expected_version from a known prior tip (C4)", async () => {
      const { contract } = makeInMemoryEventStore();
      const partition = partitionFor(activityA);
      const e1 = await buildActivityCompleted({ nonce: "n1" });
      const e2 = await buildActivityCompleted({ nonce: "n2", ts: ts1 });
      const e3 = await buildActivityCompleted({ nonce: "n3", ts: ts2 });
      await Effect.runPromise(
        contract.append(e1, { partition_key: partition, expected_tip_hash: null }),
      );
      await Effect.runPromise(
        contract.append(e2, { partition_key: partition, expected_tip_hash: e1.event_id }),
      );
      // Stale writer thinks tip is e1 — but actually tip has advanced to e2.
      const fail = await Effect.runPromise(
        Effect.flip(
          contract.append(e3, { partition_key: partition, expected_tip_hash: e1.event_id }),
        ),
      );
      expect(fail._tag).toBe("CASFailed");
      if (fail._tag === "CASFailed") {
        expect(fail.expected_version).toBe(1); // e1 was at sequence 1
        expect(fail.actual_version).toBe(2);   // partition now has 2 events
      }
    });

    it("accepts append with correct expected_tip_hash", async () => {
      const { contract } = makeInMemoryEventStore();
      const partition = partitionFor(activityA);
      const e1 = await buildActivityCompleted({ nonce: "n1" });
      await Effect.runPromise(
        contract.append(e1, { partition_key: partition, expected_tip_hash: null }),
      );
      const e2 = await buildActivityCompleted({ nonce: "n2", ts: ts1 });
      const ok = await Effect.runPromise(
        contract.append(e2, { partition_key: partition, expected_tip_hash: e1.event_id }),
      );
      expect(ok.tip_event_id).toBe(e2.event_id);
    });
  });

  describe("CL-EventStore-4 — duplicate-reject by event_id", () => {
    it("rejects append of duplicate event_id with DuplicateEvent", async () => {
      const { contract } = makeInMemoryEventStore();
      const partition = partitionFor(activityA);
      const e1 = await buildActivityCompleted({ nonce: "n1" });
      await Effect.runPromise(
        contract.append(e1, { partition_key: partition, expected_tip_hash: null }),
      );
      // Force the same event back through with the actual tip to bypass CAS.
      // Same event_id ⇒ DuplicateEvent.
      const fail = await Effect.runPromise(
        Effect.flip(
          contract.append(e1, { partition_key: partition, expected_tip_hash: e1.event_id }),
        ),
      );
      expect(fail._tag).toBe("DuplicateEvent");
      if (fail._tag === "DuplicateEvent") {
        expect(fail.existing_event_id).toBe(e1.event_id);
      }
    });
  });

  describe("CL-EventStore-5 — partition_key.scope mismatch", () => {
    it("rejects append to partition with wrong scope when store is scope-locked", async () => {
      const { contract } = makeInMemoryEventStore({ expectedScope: "activity" });
      const composite = compositePartition("worldfoo", "actbar");
      const e1 = await buildActivityCompleted({ nonce: "n1" });
      const fail = await Effect.runPromise(
        Effect.flip(
          contract.append(e1, { partition_key: composite, expected_tip_hash: null }),
        ),
      );
      expect(fail._tag).toBe("PartitionScopeMismatch");
      if (fail._tag === "PartitionScopeMismatch") {
        expect(fail.expected_scope).toBe("activity");
        expect(fail.actual_scope).toBe("composite");
      }
    });
  });

  describe("CL-EventStore-6 — replay-determinism", () => {
    it("read() returns events in the same order across calls (10 reads agree)", async () => {
      const { contract } = makeInMemoryEventStore();
      const partition = partitionFor(activityA);
      const events = await Promise.all(
        Array.from({ length: 5 }, (_, i) => buildActivityCompleted({ nonce: `n${i}` })),
      );
      let priorTip: EventId | null = null;
      for (const e of events) {
        const tip: { readonly tip_event_id: EventId | null } = await Effect.runPromise(
          contract.append(e, { partition_key: partition, expected_tip_hash: priorTip }),
        );
        priorTip = tip.tip_event_id;
      }
      const first = await Effect.runPromise(contract.read(partition));
      const firstIds = first.map((e) => e.event_id);
      for (let i = 0; i < 10; i++) {
        const again = await Effect.runPromise(contract.read(partition));
        expect(again.map((e) => e.event_id)).toEqual(firstIds);
      }
    });

    it("read rejects negative after_sequence with SchemaValidation (C7)", async () => {
      const { contract } = makeInMemoryEventStore();
      const partition = partitionFor(activityA);
      const e1 = await buildActivityCompleted({ nonce: "n1" });
      await Effect.runPromise(
        contract.append(e1, { partition_key: partition, expected_tip_hash: null }),
      );
      const failure = await Effect.runPromise(Effect.flip(contract.read(partition, -1)));
      expect(failure._tag).toBe("SchemaValidation");
    });

    it("read rejects non-integer after_sequence with SchemaValidation (C7)", async () => {
      const { contract } = makeInMemoryEventStore();
      const partition = partitionFor(activityA);
      const failure = await Effect.runPromise(Effect.flip(contract.read(partition, 1.5)));
      expect(failure._tag).toBe("SchemaValidation");
    });

    it("read with after_sequence skips the first N events", async () => {
      const { contract } = makeInMemoryEventStore();
      const partition = partitionFor(activityA);
      const events = await Promise.all(
        Array.from({ length: 3 }, (_, i) => buildActivityCompleted({ nonce: `n${i}` })),
      );
      let priorTip: EventId | null = null;
      for (const e of events) {
        const tip: { readonly tip_event_id: EventId | null } = await Effect.runPromise(
          contract.append(e, { partition_key: partition, expected_tip_hash: priorTip }),
        );
        priorTip = tip.tip_event_id;
      }
      const tail = await Effect.runPromise(contract.read(partition, 1));
      expect(tail.length).toBe(2);
      expect(tail[0]!.event_id).toBe(events[1]!.event_id);
    });
  });

  describe("CL-EventStore-7 — nonce-mediated collision (same payload, distinct nonce)", () => {
    it("accepts two events with identical payload + different nonces (different event_ids)", async () => {
      const { contract } = makeInMemoryEventStore();
      const partition = partitionFor(activityA);
      const e1 = await buildActivityCompleted({ nonce: "n1" });
      const e2 = await buildActivityCompleted({ nonce: "n2" });
      expect(e1.event_id).not.toBe(e2.event_id);
      const tip1 = await Effect.runPromise(
        contract.append(e1, { partition_key: partition, expected_tip_hash: null }),
      );
      const tip2 = await Effect.runPromise(
        contract.append(e2, { partition_key: partition, expected_tip_hash: tip1.tip_event_id }),
      );
      expect(tip2.monotonic_sequence).toBe(2);
    });
  });

  describe("T2.3 — Fix-A1 nonce enforcement", () => {
    it("rejects mutating event with null nonce → NonceRequired", async () => {
      const { contract } = makeInMemoryEventStore({ verifyEventId: false });
      const partition = partitionFor(activityA);
      const event = await buildProgressAdvanced({ nonce: null });
      const fail = await Effect.runPromise(
        Effect.flip(
          contract.append(event as unknown as ActivityCompleted, {
            partition_key: partition,
            expected_tip_hash: null,
          }),
        ),
      );
      expect(fail._tag).toBe("NonceRequired");
      if (fail._tag === "NonceRequired") {
        expect(fail.event_type).toContain("progress-advanced");
      }
    });

    it("accepts mutating event with caller-supplied nonce", async () => {
      const { contract } = makeInMemoryEventStore({
        verifyEventId: true,
      });
      const partition = partitionFor(activityA);
      const event = await buildProgressAdvanced({ nonce: "supplied" });
      const tip = await Effect.runPromise(
        contract.append(event as unknown as ActivityCompleted, {
          partition_key: partition,
          expected_tip_hash: null,
        }),
      );
      expect(tip.monotonic_sequence).toBe(1);
    });
  });
});

describe("CompletionEventPort — in-memory adapter", () => {
  it("emit appends to the activity-scoped partition + returns event_id", async () => {
    const { port } = makeInMemoryEventStore();
    const e1 = await buildActivityCompleted({ nonce: "n1" });
    const id = await Effect.runPromise(port.emit(e1));
    expect(id).toBe(e1.event_id);
  });

  it("query by activity_id returns only that activity's events", async () => {
    const { port } = makeInMemoryEventStore();
    const e1 = await buildActivityCompleted({ nonce: "n1", activityId: activityA });
    const e2 = await buildActivityCompleted({ nonce: "n2", activityId: activityB });
    await Effect.runPromise(port.emit(e1));
    await Effect.runPromise(port.emit(e2));
    const filteredA = await Effect.runPromise(port.query({ activity_id: activityA }));
    expect(filteredA.length).toBe(1);
    expect(filteredA[0]!.activity_id).toBe(activityA);
    const filteredB = await Effect.runPromise(port.query({ activity_id: activityB }));
    expect(filteredB.length).toBe(1);
    expect(filteredB[0]!.activity_id).toBe(activityB);
  });

  it("query honors limit", async () => {
    const { port } = makeInMemoryEventStore();
    const e1 = await buildActivityCompleted({ nonce: "n1" });
    const e2 = await buildActivityCompleted({ nonce: "n2", ts: ts1 });
    await Effect.runPromise(port.emit(e1));
    await Effect.runPromise(port.emit(e2));
    const limited = await Effect.runPromise(port.query({ limit: 1 }));
    expect(limited.length).toBe(1);
  });

  it("query honors ts_after / ts_before bounds", async () => {
    const { port } = makeInMemoryEventStore();
    const e1 = await buildActivityCompleted({ nonce: "n1", ts: ts0 });
    const e2 = await buildActivityCompleted({ nonce: "n2", ts: ts1 });
    const e3 = await buildActivityCompleted({ nonce: "n3", ts: ts2 });
    await Effect.runPromise(port.emit(e1));
    await Effect.runPromise(port.emit(e2));
    await Effect.runPromise(port.emit(e3));
    const middle = await Effect.runPromise(
      port.query({ ts_after: ts0, ts_before: ts2 }),
    );
    expect(middle.length).toBe(1);
    expect(middle[0]!.ts).toBe(ts1);
  });
});
