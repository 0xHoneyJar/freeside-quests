import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ActivityId,
  EventId,
  IdentityId,
  ProgressAdvanced,
  ProgressRecord,
  RFC3339Date,
  StepId,
} from "@0xhoneyjar/quests-protocol";

import { makeInMemoryProgressPort } from "../progress.js";

const decode = Schema.decodeUnknownSync;

const activityA = decode(ActivityId)("act_a");
const activityB = decode(ActivityId)("act_b");
const identityA = decode(IdentityId)("id_a");
const identityB = decode(IdentityId)("id_b");

const stepFoo = decode(StepId)("step_foo");
const stepBar = decode(StepId)("step_bar");

const eventOne = decode(EventId)("a".repeat(64));
const eventTwo = decode(EventId)("b".repeat(64));

const ts0 = decode(RFC3339Date)("2026-05-16T00:00:00Z");
const ts1 = decode(RFC3339Date)("2026-05-16T00:01:00Z");

type ActivityIdT = Schema.Schema.Type<typeof ActivityId>;
type IdentityIdT = Schema.Schema.Type<typeof IdentityId>;
type EventIdT = Schema.Schema.Type<typeof EventId>;
type ProgressAdvancedT = Schema.Schema.Type<typeof ProgressAdvanced>;

const advanceEvent = (overrides: {
  activityId?: ActivityIdT;
  identityId?: IdentityIdT;
  versionBefore: number;
  versionAfter: number;
  eventId?: EventIdT;
  completions?: ProgressAdvancedT["new_step_completions"];
}): ProgressAdvancedT => ({
  event_id: overrides.eventId ?? eventOne,
  preimage_schema_id: "https://schemas.freeside.thj/preimage/progress-advanced/v1.0.0",
  ts: ts0,
  source_event_hash: null,
  nonce: "test-nonce",
  schema_version: "1.0.0",
  $id: "https://schemas.freeside.thj/progress-advanced/v1.0.0",
  activity_id: overrides.activityId ?? activityA,
  identity_id: overrides.identityId ?? identityA,
  new_step_completions: overrides.completions ?? [
    {
      step_id: stepFoo,
      order: 0,
      completed_at: ts0,
      event_id: overrides.eventId ?? eventOne,
    },
  ],
  version_before: overrides.versionBefore,
  version_after: overrides.versionAfter,
});

describe("makeInMemoryProgressPort", () => {
  describe("getProgress", () => {
    it("returns NOT_STARTED baseline when no record exists", async () => {
      const { port } = makeInMemoryProgressPort();
      const result = await Effect.runPromise(port.getProgress(activityA, identityA));
      expect(result.activity_id).toBe(activityA);
      expect(result.identity_id).toBe(identityA);
      expect(result.lifecycle_state).toBe("NOT_STARTED");
      expect(result.version).toBe(0);
      expect(result.steps_completed).toEqual([]);
      expect(result.current_step).toBeNull();
      expect(result.last_advanced_event_id).toBeNull();
    });

    it("returns seeded record verbatim", async () => {
      const seeded: ProgressRecord = {
        activity_id: activityA,
        identity_id: identityA,
        current_step: stepFoo,
        steps_completed: [
          {
            step_id: stepFoo,
            order: 0,
            completed_at: ts0,
            event_id: eventOne,
          },
        ],
        last_advanced_event_id: eventOne,
        version: 3,
        lifecycle_state: "IN_PROGRESS",
      };
      const { port, seed } = makeInMemoryProgressPort();
      seed(seeded);
      const result = await Effect.runPromise(port.getProgress(activityA, identityA));
      expect(result).toEqual(seeded);
    });

    it("rejects unknown activity with ActivityNotFound when catalog is restricted", async () => {
      const { port } = makeInMemoryProgressPort({
        knownActivities: new Set([activityA]),
      });
      const failure = await Effect.runPromise(Effect.flip(port.getProgress(activityB, identityA)));
      expect(failure._tag).toBe("ActivityNotFound");
      if (failure._tag === "ActivityNotFound") {
        expect(failure.activity_id).toBe(activityB);
      }
    });

    it("rejects unknown identity with IdentityNotFound when catalog is restricted", async () => {
      const { port } = makeInMemoryProgressPort({
        knownIdentities: new Set([identityA]),
      });
      const failure = await Effect.runPromise(Effect.flip(port.getProgress(activityA, identityB)));
      expect(failure._tag).toBe("IdentityNotFound");
      if (failure._tag === "IdentityNotFound") {
        expect(failure.identity_id).toBe(identityB);
      }
    });

    it("surfaces AdapterUnavailable via simulated failure hook", async () => {
      const { port } = makeInMemoryProgressPort({
        simulatedFailures: [{ on: "getProgress", reason: "db-down" }],
      });
      const failure = await Effect.runPromise(Effect.flip(port.getProgress(activityA, identityA)));
      expect(failure._tag).toBe("AdapterUnavailable");
      if (failure._tag === "AdapterUnavailable") {
        expect(failure.reason).toBe("db-down");
        expect(failure.adapter_id).toBe("in-memory:progress");
      }
    });
  });

  describe("advanceProgress", () => {
    it("creates a record on first advance (version_before 0)", async () => {
      const { port, snapshot } = makeInMemoryProgressPort();
      const event = advanceEvent({ versionBefore: 0, versionAfter: 1 });
      const next = await Effect.runPromise(port.advanceProgress(event));
      expect(next.version).toBe(1);
      expect(next.lifecycle_state).toBe("IN_PROGRESS");
      expect(next.last_advanced_event_id).toBe(eventOne);
      expect(next.current_step).toBe(stepFoo);
      expect(next.steps_completed).toHaveLength(1);
      expect(snapshot().size).toBe(1);
    });

    it("merges step completions across advances", async () => {
      const { port } = makeInMemoryProgressPort();
      const first = advanceEvent({
        versionBefore: 0,
        versionAfter: 1,
        completions: [
          { step_id: stepFoo, order: 0, completed_at: ts0, event_id: eventOne },
        ],
      });
      await Effect.runPromise(port.advanceProgress(first));
      const second = advanceEvent({
        versionBefore: 1,
        versionAfter: 2,
        eventId: eventTwo,
        completions: [
          { step_id: stepBar, order: 1, completed_at: ts1, event_id: eventTwo },
        ],
      });
      const merged = await Effect.runPromise(port.advanceProgress(second));
      expect(merged.version).toBe(2);
      expect(merged.steps_completed).toHaveLength(2);
      expect(merged.current_step).toBe(stepBar);
      expect(merged.last_advanced_event_id).toBe(eventTwo);
    });

    it("rejects stale version_before with ConcurrentUpdate (CL-Progress-1)", async () => {
      const { port } = makeInMemoryProgressPort();
      await Effect.runPromise(
        port.advanceProgress(advanceEvent({ versionBefore: 0, versionAfter: 1 })),
      );
      // Two callers both seeing version 0 attempt to advance → second loses
      const stale = advanceEvent({
        versionBefore: 0,
        versionAfter: 1,
        eventId: eventTwo,
      });
      const failure = await Effect.runPromise(Effect.flip(port.advanceProgress(stale)));
      expect(failure._tag).toBe("ConcurrentUpdate");
      if (failure._tag === "ConcurrentUpdate") {
        expect(failure.current_version).toBe(1);
        expect(failure.attempted_version).toBe(0);
      }
    });

    it("rejects unknown activity when catalog is restricted", async () => {
      const { port } = makeInMemoryProgressPort({
        knownActivities: new Set([activityA]),
      });
      const event = advanceEvent({
        activityId: activityB,
        versionBefore: 0,
        versionAfter: 1,
      });
      const failure = await Effect.runPromise(Effect.flip(port.advanceProgress(event)));
      expect(failure._tag).toBe("ActivityNotFound");
    });

    it("rejects unknown identity when catalog is restricted", async () => {
      const { port } = makeInMemoryProgressPort({
        knownIdentities: new Set([identityA]),
      });
      const event = advanceEvent({
        identityId: identityB,
        versionBefore: 0,
        versionAfter: 1,
      });
      const failure = await Effect.runPromise(Effect.flip(port.advanceProgress(event)));
      expect(failure._tag).toBe("IdentityNotFound");
    });

    it("surfaces AdapterUnavailable via simulated failure hook on advanceProgress", async () => {
      const { port } = makeInMemoryProgressPort({
        simulatedFailures: [{ on: "advanceProgress", reason: "write-conflict" }],
      });
      const failure = await Effect.runPromise(
        Effect.flip(port.advanceProgress(advanceEvent({ versionBefore: 0, versionAfter: 1 }))),
      );
      expect(failure._tag).toBe("AdapterUnavailable");
    });
  });

  describe("CL-Port-2 — every error variant is reachable", () => {
    it("touches all 4 ProgressError variants from one port instance", async () => {
      const reached = new Set<string>();
      const { port } = makeInMemoryProgressPort({
        knownActivities: new Set([activityA]),
        knownIdentities: new Set([identityA]),
        simulatedFailures: [{ on: "any", reason: "induced" }],
      });
      // 1. AdapterUnavailable (consumes the simulated failure)
      const fail1 = await Effect.runPromise(Effect.flip(port.getProgress(activityA, identityA)));
      reached.add(fail1._tag);
      // 2. ActivityNotFound
      const fail2 = await Effect.runPromise(Effect.flip(port.getProgress(activityB, identityA)));
      reached.add(fail2._tag);
      // 3. IdentityNotFound
      const fail3 = await Effect.runPromise(Effect.flip(port.getProgress(activityA, identityB)));
      reached.add(fail3._tag);
      // 4. ConcurrentUpdate
      await Effect.runPromise(
        port.advanceProgress(advanceEvent({ versionBefore: 0, versionAfter: 1 })),
      );
      const fail4 = await Effect.runPromise(
        Effect.flip(
          port.advanceProgress(advanceEvent({ versionBefore: 0, versionAfter: 1 })),
        ),
      );
      reached.add(fail4._tag);

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
