/**
 * EventStoreContract conformance suite as a factory function
 * (sprint-2 review C3 · Fix-S5 reusable black-box).
 *
 * Any adapter that implements EventStoreContract + CompletionEventPort can
 * import `runEventStoreConformanceSuite` and pass its factory. The same
 * `describe`/`it` blocks run against the adapter — postgres + convex
 * gateways re-run the in-memory suite by swapping the factory.
 *
 * Factory contract:
 *   - returns a `{ contract, port, snapshot?, clear? }` bundle
 *   - bundle MUST be freshly-allocated per call (independent stores)
 *   - bundle's `clear()` MUST reset state to empty
 *
 * Optional configurator: tests that need `expectedScope` / `verifyEventId`
 * variants pass a config-aware factory.
 */
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ActivityCompleted,
  ActivityId,
  type CompletionEventPort,
  computeEventIdSync,
  type EventId,
  type EventStoreContract,
  IdentityId,
  type PartitionKey,
  PartitionScope,
  ProgressAdvanced,
  RFC3339Date,
  StepId,
} from "@0xhoneyjar/quests-protocol";

export interface EventStoreConformanceBundle {
  readonly contract: EventStoreContract;
  readonly port: CompletionEventPort;
  readonly clear?: () => void;
}

export interface EventStoreConformanceFactoryConfig {
  readonly expectedScope?: PartitionKey["scope"];
  readonly verifyEventId?: boolean;
}

export type EventStoreConformanceFactory = (
  config?: EventStoreConformanceFactoryConfig,
) => EventStoreConformanceBundle;

const decode = Schema.decodeUnknownSync;

const fixtures = {
  activityA: decode(ActivityId)("act_a"),
  activityB: decode(ActivityId)("act_b"),
  identityA: decode(IdentityId)("id_a"),
  stepFoo: decode(StepId)("step_foo"),
  ts0: decode(RFC3339Date)("2026-05-16T00:00:00Z"),
  ts1: decode(RFC3339Date)("2026-05-16T00:01:00Z"),
  ts2: decode(RFC3339Date)("2026-05-16T00:02:00Z"),
};

const partitionFor = (activityId: typeof fixtures.activityA): PartitionKey =>
  ({ scope: "activity" as PartitionScope, value: activityId as unknown as string }) as PartitionKey;

const compositePartition = (a: string, b: string): PartitionKey =>
  ({ scope: "composite" as PartitionScope, value: `${a}::${b}` }) as PartitionKey;

const buildActivityCompleted = async (overrides: {
  activityId?: typeof fixtures.activityA;
  ts?: typeof fixtures.ts0;
  nonce: string;
  sourceEventHash?: string | null;
}): Promise<ActivityCompleted> => {
  const draft = {
    event_id: "0".repeat(64),
    preimage_schema_id: "https://schemas.freeside.thj/preimage/activity-completed/v1.0.0",
    ts: overrides.ts ?? fixtures.ts0,
    source_event_hash: overrides.sourceEventHash ?? null,
    nonce: overrides.nonce,
    schema_version: "1.0.0" as const,
    $id: "https://schemas.freeside.thj/activity-completed/v1.0.0" as const,
    activity_id: overrides.activityId ?? fixtures.activityA,
    identity_id: fixtures.identityA,
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
    event_id: "0".repeat(64),
    preimage_schema_id: "https://schemas.freeside.thj/preimage/progress-advanced/v1.0.0",
    ts: fixtures.ts0,
    source_event_hash: null,
    nonce: overrides.nonce,
    schema_version: "1.0.0" as const,
    $id: "https://schemas.freeside.thj/progress-advanced/v1.0.0" as const,
    activity_id: fixtures.activityA,
    identity_id: fixtures.identityA,
    new_step_completions: [],
    version_before: overrides.versionBefore ?? 0,
    version_after: overrides.versionAfter ?? 1,
  };
  if (overrides.nonce === null) {
    return decode(ProgressAdvanced)({
      ...draft,
      event_id: "deadbeef".repeat(8),
    });
  }
  const computed = await computeEventIdSync(
    draft as unknown as Record<string, unknown> & { $id: string; nonce: string | null },
  );
  return decode(ProgressAdvanced)({ ...draft, event_id: computed });
};

/**
 * runEventStoreConformanceSuite — black-box conformance gate.
 *
 * Adapter test files invoke this with their factory. Each `it` block
 * builds a fresh bundle, exercises the contract, asserts the invariant.
 *
 * Note for postgres / convex adapter authors: the suite exercises ~16
 * scenarios across CL-EventStore-1..7 + Fix-A1. Your adapter MUST pass
 * every scenario without modification. If a scenario is genuinely
 * inapplicable to your adapter (e.g., the in-memory `verifyEventId`
 * config doesn't translate cleanly), document the deviation in the
 * adapter's README — do NOT fork the conformance suite.
 */
export const runEventStoreConformanceSuite = (
  factory: EventStoreConformanceFactory,
  adapterName: string,
): void => {
  describe(`EventStoreContract conformance — ${adapterName}`, () => {
    describe("CL-EventStore-1 + CL-EventStore-2 — append-only + monotonic-sequence", () => {
      it("appends N events and read returns them in monotonic-sequence order", async () => {
        const { contract } = factory();
        const partition = partitionFor(fixtures.activityA);
        const e1 = await buildActivityCompleted({ nonce: "n1" });
        const e2 = await buildActivityCompleted({ nonce: "n2", ts: fixtures.ts1 });
        const e3 = await buildActivityCompleted({ nonce: "n3", ts: fixtures.ts2 });

        const tip1 = await Effect.runPromise(
          contract.append(e1, { partition_key: partition, expected_tip_hash: null }),
        );
        expect(tip1.monotonic_sequence).toBe(1);
        expect(tip1.tip_event_id).toBe(e1.event_id);

        await Effect.runPromise(
          contract.append(e2, { partition_key: partition, expected_tip_hash: e1.event_id }),
        );
        const tip3 = await Effect.runPromise(
          contract.append(e3, { partition_key: partition, expected_tip_hash: e2.event_id }),
        );
        expect(tip3.monotonic_sequence).toBe(3);

        const read = await Effect.runPromise(contract.read(partition));
        expect(read.length).toBe(3);
        expect(read.map((e) => e.event_id)).toEqual([e1.event_id, e2.event_id, e3.event_id]);
      });

      it("getTip on empty partition returns null tip + sequence 0", async () => {
        const { contract } = factory();
        const tip = await Effect.runPromise(contract.getTip(partitionFor(fixtures.activityB)));
        expect(tip.tip_event_id).toBeNull();
        expect(tip.monotonic_sequence).toBe(0);
      });
    });

    describe("CL-EventStore-3 — CAS via expected_tip_hash", () => {
      it("rejects stale tip; CASFailed payload carries distinct expected vs actual versions", async () => {
        const { contract } = factory();
        const partition = partitionFor(fixtures.activityA);
        const e1 = await buildActivityCompleted({ nonce: "n1" });
        const e2 = await buildActivityCompleted({ nonce: "n2", ts: fixtures.ts1 });
        await Effect.runPromise(
          contract.append(e1, { partition_key: partition, expected_tip_hash: null }),
        );
        const fail = await Effect.runPromise(
          Effect.flip(
            contract.append(e2, { partition_key: partition, expected_tip_hash: null }),
          ),
        );
        expect(fail._tag).toBe("CASFailed");
        if (fail._tag === "CASFailed") {
          expect(fail.expected_version).toBe(0);
          expect(fail.actual_version).toBe(1);
        }
      });

      it("accepts append with correct expected_tip_hash", async () => {
        const { contract } = factory();
        const partition = partitionFor(fixtures.activityA);
        const e1 = await buildActivityCompleted({ nonce: "n1" });
        await Effect.runPromise(
          contract.append(e1, { partition_key: partition, expected_tip_hash: null }),
        );
        const e2 = await buildActivityCompleted({ nonce: "n2", ts: fixtures.ts1 });
        const ok = await Effect.runPromise(
          contract.append(e2, { partition_key: partition, expected_tip_hash: e1.event_id }),
        );
        expect(ok.tip_event_id).toBe(e2.event_id);
      });
    });

    describe("CL-EventStore-4 — duplicate-reject by event_id", () => {
      it("rejects duplicate event_id with DuplicateEvent", async () => {
        const { contract } = factory();
        const partition = partitionFor(fixtures.activityA);
        const e1 = await buildActivityCompleted({ nonce: "n1" });
        await Effect.runPromise(
          contract.append(e1, { partition_key: partition, expected_tip_hash: null }),
        );
        const fail = await Effect.runPromise(
          Effect.flip(
            contract.append(e1, { partition_key: partition, expected_tip_hash: e1.event_id }),
          ),
        );
        expect(fail._tag).toBe("DuplicateEvent");
      });
    });

    describe("CL-EventStore-5 — partition_key.scope mismatch", () => {
      it("rejects append to wrong-scope partition when store is scope-locked", async () => {
        const { contract } = factory({ expectedScope: "activity" });
        const composite = compositePartition("worldfoo", "actbar");
        const e1 = await buildActivityCompleted({ nonce: "n1" });
        const fail = await Effect.runPromise(
          Effect.flip(
            contract.append(e1, { partition_key: composite, expected_tip_hash: null }),
          ),
        );
        expect(fail._tag).toBe("PartitionScopeMismatch");
      });
    });

    describe("CL-EventStore-6 — replay-determinism", () => {
      it("read() returns events in stable order across 10 reads", async () => {
        const { contract } = factory();
        const partition = partitionFor(fixtures.activityA);
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

      it("read rejects negative after_sequence with SchemaValidation", async () => {
        const { contract } = factory();
        const failure = await Effect.runPromise(
          Effect.flip(contract.read(partitionFor(fixtures.activityA), -1)),
        );
        expect(failure._tag).toBe("SchemaValidation");
      });
    });

    describe("CL-EventStore-7 — nonce-mediated collision", () => {
      it("accepts two events with identical payload + distinct nonces", async () => {
        const { contract } = factory();
        const partition = partitionFor(fixtures.activityA);
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

    describe("Fix-A1 nonce enforcement", () => {
      it("rejects mutating event with null nonce → NonceRequired", async () => {
        const { contract } = factory({ verifyEventId: false });
        const partition = partitionFor(fixtures.activityA);
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
      });

      it("accepts mutating event with caller-supplied nonce", async () => {
        const { contract } = factory({ verifyEventId: true });
        const partition = partitionFor(fixtures.activityA);
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

    describe("CompletionEventPort surface", () => {
      it("emit appends to the activity-scoped partition + returns event_id", async () => {
        const { port } = factory();
        const e1 = await buildActivityCompleted({ nonce: "n1" });
        const id = await Effect.runPromise(port.emit(e1));
        expect(id).toBe(e1.event_id);
      });

      it("query by activity_id filters correctly", async () => {
        const { port } = factory();
        const e1 = await buildActivityCompleted({ nonce: "n1", activityId: fixtures.activityA });
        const e2 = await buildActivityCompleted({ nonce: "n2", activityId: fixtures.activityB });
        await Effect.runPromise(port.emit(e1));
        await Effect.runPromise(port.emit(e2));
        const filtered = await Effect.runPromise(port.query({ activity_id: fixtures.activityA }));
        expect(filtered.length).toBe(1);
        expect(filtered[0]!.activity_id).toBe(fixtures.activityA);
      });
    });
  });
};
