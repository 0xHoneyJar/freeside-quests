/**
 * ProgressPort conformance suite as a factory function
 * (write-path defect #21.3 · reusable black-box).
 *
 * BEFORE this suite, `makePostgresProgressPort` ran ZERO test lines — a
 * reward-granting adapter with no conformance gate. This suite is the shared
 * black-box contract every ProgressPort implementation MUST pass: in-memory
 * (single-threaded reference) AND postgres (the real concurrency target).
 *
 * Factory contract:
 *   - returns a `{ port, seed?, clear? }` bundle
 *   - bundle MUST be freshly-allocated per call (independent store)
 *   - the optional `config` lets scenarios reach the *NotFound / AdapterUnavailable
 *     variants (CL-Port-2 reachability) via the same `knownActivities` /
 *     `knownIdentities` / `simulatedFailures` hooks both adapters already expose.
 *
 * The OPTIMISTIC-CAS invariant (CL-Progress-1) is the load-bearing assertion:
 * advanceProgress checks version_before == stored version and the LOSER of a
 * version race fails ConcurrentUpdate. This suite proves it SERIALLY for every
 * adapter; the postgres adapter additionally proves it under genuine
 * concurrency in its own race test (progress-concurrency.test.ts).
 */
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ActivityId,
  EventId,
  IdentityId,
  type ProgressAdvanced,
  type ProgressPort,
  RFC3339Date,
  StepId,
} from "@0xhoneyjar/quests-protocol";

const decode = Schema.decodeUnknownSync;

const fixtures = {
  activityA: decode(ActivityId)("act_a"),
  activityB: decode(ActivityId)("act_b"),
  identityA: decode(IdentityId)("id_a"),
  identityB: decode(IdentityId)("id_b"),
  stepFoo: decode(StepId)("step_foo"),
  stepBar: decode(StepId)("step_bar"),
  eventOne: decode(EventId)("a".repeat(64)),
  eventTwo: decode(EventId)("b".repeat(64)),
  ts0: decode(RFC3339Date)("2026-05-16T00:00:00Z"),
  ts1: decode(RFC3339Date)("2026-05-16T00:01:00Z"),
};

export interface ProgressPortConformanceBundle {
  readonly port: ProgressPort;
  readonly clear?: () => void;
}

export interface ProgressPortConformanceFactoryConfig {
  readonly knownActivities?: ReadonlySet<typeof fixtures.activityA>;
  readonly knownIdentities?: ReadonlySet<typeof fixtures.identityA>;
  readonly simulatedFailures?: ReadonlyArray<{
    readonly on: "getProgress" | "advanceProgress" | "any";
    readonly reason: string;
  }>;
}

export type ProgressPortConformanceFactory = (
  config?: ProgressPortConformanceFactoryConfig,
) => ProgressPortConformanceBundle;

const advanceEvent = (overrides: {
  activityId?: typeof fixtures.activityA;
  identityId?: typeof fixtures.identityA;
  versionBefore: number;
  versionAfter: number;
  eventId?: typeof fixtures.eventOne;
}): ProgressAdvanced =>
  ({
    event_id: overrides.eventId ?? fixtures.eventOne,
    preimage_schema_id:
      "https://schemas.freeside.thj/preimage/progress-advanced/v1.0.0",
    ts: fixtures.ts0,
    source_event_hash: null,
    nonce: "test-nonce",
    schema_version: "1.0.0",
    $id: "https://schemas.freeside.thj/progress-advanced/v1.0.0",
    activity_id: overrides.activityId ?? fixtures.activityA,
    identity_id: overrides.identityId ?? fixtures.identityA,
    new_step_completions: [
      {
        step_id: fixtures.stepFoo,
        order: 0,
        completed_at: fixtures.ts0,
        event_id: overrides.eventId ?? fixtures.eventOne,
      },
    ],
    version_before: overrides.versionBefore,
    version_after: overrides.versionAfter,
  }) as unknown as ProgressAdvanced;

/**
 * runProgressPortConformanceSuite — black-box conformance gate for ProgressPort.
 *
 * Adapters MUST pass:
 *   - getProgress on a never-touched (activity, identity) → NOT_STARTED baseline
 *   - advanceProgress (version_before 0) creates the record at version_after
 *   - subsequent advance (version_before == stored) advances + merges steps
 *   - CL-Progress-1 optimistic-CAS: a stale version_before → ConcurrentUpdate
 *     carrying current/attempted versions (the FIRST-ADVANCE race included —
 *     defect #21.1: two version_before=0 advances cannot BOTH succeed)
 *   - CL-Port-2: every ProgressError variant reachable from one port instance
 */
export const runProgressPortConformanceSuite = (
  factory: ProgressPortConformanceFactory,
  adapterName: string,
): void => {
  describe(`ProgressPort conformance — ${adapterName}`, () => {
    it("getProgress on a never-touched pair → NOT_STARTED baseline (version 0)", async () => {
      const { port } = factory();
      const r = await Effect.runPromise(
        port.getProgress(fixtures.activityA, fixtures.identityA),
      );
      expect(r.lifecycle_state).toBe("NOT_STARTED");
      expect(r.version).toBe(0);
      expect(r.steps_completed).toEqual([]);
      expect(r.current_step).toBeNull();
      expect(r.last_advanced_event_id).toBeNull();
    });

    it("first advance (version_before 0) creates the record at version_after", async () => {
      const { port } = factory();
      const next = await Effect.runPromise(
        port.advanceProgress(advanceEvent({ versionBefore: 0, versionAfter: 1 })),
      );
      expect(next.version).toBe(1);
      expect(next.lifecycle_state).toBe("IN_PROGRESS");
      expect(next.last_advanced_event_id).toBe(fixtures.eventOne);
      expect(next.current_step).toBe(fixtures.stepFoo);
      expect(next.steps_completed).toHaveLength(1);

      // It is durable: a re-read returns the advanced record.
      const reread = await Effect.runPromise(
        port.getProgress(fixtures.activityA, fixtures.identityA),
      );
      expect(reread.version).toBe(1);
      expect(reread.lifecycle_state).toBe("IN_PROGRESS");
    });

    it("subsequent advance (version_before == stored) advances + merges steps", async () => {
      const { port } = factory();
      await Effect.runPromise(
        port.advanceProgress(advanceEvent({ versionBefore: 0, versionAfter: 1 })),
      );
      const merged = await Effect.runPromise(
        port.advanceProgress(
          advanceEvent({ versionBefore: 1, versionAfter: 2, eventId: fixtures.eventTwo }),
        ),
      );
      expect(merged.version).toBe(2);
      expect(merged.steps_completed).toHaveLength(2);
      expect(merged.last_advanced_event_id).toBe(fixtures.eventTwo);
    });

    describe("CL-Progress-1 — optimistic-CAS invariant", () => {
      it("stale version_before (after an advance) → ConcurrentUpdate (current/attempted)", async () => {
        const { port } = factory();
        await Effect.runPromise(
          port.advanceProgress(advanceEvent({ versionBefore: 0, versionAfter: 1 })),
        );
        // A second caller still thinks the version is 0 → loses the CAS.
        const stale = advanceEvent({
          versionBefore: 0,
          versionAfter: 1,
          eventId: fixtures.eventTwo,
        });
        const failure = await Effect.runPromise(
          Effect.flip(port.advanceProgress(stale)),
        );
        expect(failure._tag).toBe("ConcurrentUpdate");
        if (failure._tag === "ConcurrentUpdate") {
          expect(failure.current_version).toBe(1);
          expect(failure.attempted_version).toBe(0);
        }

        // CRITICAL: the loser did NOT clobber the winner — version is still 1
        // and the winner's event is still the last-advanced.
        const after = await Effect.runPromise(
          port.getProgress(fixtures.activityA, fixtures.identityA),
        );
        expect(after.version).toBe(1);
        expect(after.last_advanced_event_id).toBe(fixtures.eventOne);
      });
    });

    describe("CL-Port-2 — every ProgressError variant reachable", () => {
      it("touches all 4 ProgressError variants from one configured port instance", async () => {
        const reached = new Set<string>();
        const { port } = factory({
          knownActivities: new Set([fixtures.activityA]),
          knownIdentities: new Set([fixtures.identityA]),
          simulatedFailures: [{ on: "any", reason: "induced" }],
        });
        // 1. AdapterUnavailable (consumes the simulated failure)
        const f1 = await Effect.runPromise(
          Effect.flip(port.getProgress(fixtures.activityA, fixtures.identityA)),
        );
        reached.add(f1._tag);
        // 2. ActivityNotFound
        const f2 = await Effect.runPromise(
          Effect.flip(port.getProgress(fixtures.activityB, fixtures.identityA)),
        );
        reached.add(f2._tag);
        // 3. IdentityNotFound
        const f3 = await Effect.runPromise(
          Effect.flip(port.getProgress(fixtures.activityA, fixtures.identityB)),
        );
        reached.add(f3._tag);
        // 4. ConcurrentUpdate
        await Effect.runPromise(
          port.advanceProgress(advanceEvent({ versionBefore: 0, versionAfter: 1 })),
        );
        const f4 = await Effect.runPromise(
          Effect.flip(
            port.advanceProgress(advanceEvent({ versionBefore: 0, versionAfter: 1 })),
          ),
        );
        reached.add(f4._tag);

        expect(reached).toEqual(
          new Set([
            "AdapterUnavailable",
            "ActivityNotFound",
            "IdentityNotFound",
            "ConcurrentUpdate",
          ]),
        );
      });
    });
  });
};
