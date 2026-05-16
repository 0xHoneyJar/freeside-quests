import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ActivityRewardNone,
  EventId,
  IdentityId,
  type ActivityReward,
} from "@0xhoneyjar/quests-protocol";

import { makeInMemoryRewardPort } from "@0xhoneyjar/freeside-activities-adapters";

import { RetriesExhausted, retryGrant, TerminalGrantFailure } from "../retry.js";

const decode = Schema.decodeUnknownSync;
const identityA = decode(IdentityId)("id_a");
const eventOne = decode(EventId)("a".repeat(64));
const eventTwo = decode(EventId)("b".repeat(64));
const rewardNone: ActivityReward = ActivityRewardNone.make({});

// Bypass sleep delays in tests.
const noSleep = () => Effect.succeed(undefined as void);

describe("retryGrant", () => {
  describe("Pending → Granted (success)", () => {
    it("returns RewardGranted on first attempt", async () => {
      const { port } = makeInMemoryRewardPort();
      const result = await Effect.runPromise(
        retryGrant(port, rewardNone, identityA, eventOne, { sleep: noSleep }),
      );
      expect(result._tag).toBe("RewardGranted");
    });
  });

  describe("Pending → Failed-retryable → Pending (retry success)", () => {
    it("retries after retryable failure and ultimately succeeds", async () => {
      const { port } = makeInMemoryRewardPort({
        failingGrants: [
          { recipient: identityA, reason: "rpc-timeout", retryable: true },
        ],
      });
      const result = await Effect.runPromise(
        retryGrant(port, rewardNone, identityA, eventOne, {
          maxAttempts: 3,
          sleep: noSleep,
        }),
      );
      expect(result._tag).toBe("RewardGranted");
    });

    it("retries through AdapterUnavailable failures", async () => {
      const { port } = makeInMemoryRewardPort({
        simulatedFailures: [{ on: "grant", reason: "db-down" }],
      });
      const result = await Effect.runPromise(
        retryGrant(port, rewardNone, identityA, eventOne, {
          maxAttempts: 3,
          sleep: noSleep,
        }),
      );
      expect(result._tag).toBe("RewardGranted");
    });
  });

  describe("Pending → Failed-terminal (no further retries)", () => {
    it("fails with TerminalGrantFailure on non-retryable GrantFailed", async () => {
      const { port } = makeInMemoryRewardPort({
        failingGrants: [
          { recipient: identityA, reason: "policy-rejection", retryable: false },
        ],
      });
      const failure = await Effect.runPromise(
        Effect.flip(
          retryGrant(port, rewardNone, identityA, eventOne, {
            maxAttempts: 5,
            sleep: noSleep,
          }),
        ),
      );
      expect(failure._tag).toBe("TerminalGrantFailure");
      expect(failure).toBeInstanceOf(TerminalGrantFailure);
    });

    it("fails terminally on IdentityUnresolvable", async () => {
      const { port } = makeInMemoryRewardPort({
        unresolvableIdentities: new Set([identityA]),
      });
      const failure = await Effect.runPromise(
        Effect.flip(
          retryGrant(port, rewardNone, identityA, eventOne, {
            sleep: noSleep,
          }),
        ),
      );
      expect(failure._tag).toBe("TerminalGrantFailure");
    });
  });

  describe("exhaustion", () => {
    it("fails with RetriesExhausted when all attempts fail retryably", async () => {
      const { port } = makeInMemoryRewardPort({
        failingGrants: [
          { recipient: identityA, reason: "flake-1", retryable: true },
          { recipient: identityA, reason: "flake-2", retryable: true },
          { recipient: identityA, reason: "flake-3", retryable: true },
        ],
      });
      const failure = await Effect.runPromise(
        Effect.flip(
          retryGrant(port, rewardNone, identityA, eventOne, {
            maxAttempts: 3,
            sleep: noSleep,
          }),
        ),
      );
      expect(failure._tag).toBe("RetriesExhausted");
      expect(failure).toBeInstanceOf(RetriesExhausted);
      if (failure._tag === "RetriesExhausted") {
        expect(failure.attempts).toBe(3);
        expect(failure.last_error._tag).toBe("GrantFailed");
      }
    });
  });

  describe("D18 idempotency short-circuit", () => {
    it("returns existing RewardGranted when adapter reports AlreadyGranted", async () => {
      const { port } = makeInMemoryRewardPort();
      // Seed: succeed once
      const first = await Effect.runPromise(
        retryGrant(port, rewardNone, identityA, eventOne, { sleep: noSleep }),
      );
      // Retry with same (event, recipient) → AlreadyGranted short-circuit
      const second = await Effect.runPromise(
        retryGrant(port, rewardNone, identityA, eventOne, { sleep: noSleep }),
      );
      expect(second.granted_event_id).toBe(first.granted_event_id);
    });

    it("permits independent retries when originating_event_id differs", async () => {
      const { port } = makeInMemoryRewardPort();
      const a = await Effect.runPromise(
        retryGrant(port, rewardNone, identityA, eventOne, { sleep: noSleep }),
      );
      const b = await Effect.runPromise(
        retryGrant(port, rewardNone, identityA, eventTwo, { sleep: noSleep }),
      );
      expect(a.granted_event_id).not.toBe(b.granted_event_id);
    });
  });
});
