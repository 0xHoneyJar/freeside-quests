/**
 * RewardPort conformance — in-memory adapter (T2.4 · D18 idempotency).
 *
 * Per CL-Reward-2: the in-memory adapter MUST short-circuit a duplicate
 * grant request (same originating_event_id + recipient) by returning the
 * existing RewardGranted via the AlreadyGranted error variant.
 */
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ActivityRewardBadgeMint,
  ActivityRewardNone,
  type ActivityReward,
  EventId,
  IdentityId,
  MintIntentId,
} from "@0xhoneyjar/quests-protocol";

import { makeInMemoryRewardPort } from "../reward.js";

const decode = Schema.decodeUnknownSync;

const identityA = decode(IdentityId)("id_a");
const identityB = decode(IdentityId)("id_b");
const eventOne = decode(EventId)("a".repeat(64));
const eventTwo = decode(EventId)("b".repeat(64));
const mintIntent = decode(MintIntentId)("mint_demo01");

const rewardNone: ActivityReward = ActivityRewardNone.make({});
const rewardBadge: ActivityReward = ActivityRewardBadgeMint.make({
  mint_intent_id: mintIntent,
});

describe("makeInMemoryRewardPort", () => {
  describe("happy path", () => {
    it("grants a reward and returns RewardGranted", async () => {
      const { port } = makeInMemoryRewardPort();
      const result = await Effect.runPromise(port.grant(rewardNone, identityA, eventOne));
      expect(result._tag).toBe("RewardGranted");
      expect(result.originating_event_id).toBe(eventOne);
      expect(result.granted_event_id).toBeTruthy();
    });

    it("query returns granted rewards per identity", async () => {
      const { port } = makeInMemoryRewardPort();
      await Effect.runPromise(port.grant(rewardNone, identityA, eventOne));
      await Effect.runPromise(port.grant(rewardBadge, identityA, eventTwo));
      const records = await Effect.runPromise(port.query(identityA));
      expect(records.length).toBe(2);
    });

    it("query returns empty array for identity with no grants", async () => {
      const { port } = makeInMemoryRewardPort();
      await Effect.runPromise(port.grant(rewardNone, identityA, eventOne));
      const records = await Effect.runPromise(port.query(identityB));
      expect(records).toEqual([]);
    });
  });

  describe("CL-Reward-2 — D18 idempotency", () => {
    it("rejects duplicate grant (same tuple) with AlreadyGranted carrying existing grant id", async () => {
      const { port, snapshot } = makeInMemoryRewardPort();
      const first = await Effect.runPromise(port.grant(rewardNone, identityA, eventOne));
      const dupFail = await Effect.runPromise(
        Effect.flip(port.grant(rewardNone, identityA, eventOne)),
      );
      expect(dupFail._tag).toBe("AlreadyGranted");
      if (dupFail._tag === "AlreadyGranted") {
        expect(dupFail.existing_grant_id).toBe(first.granted_event_id);
        expect(dupFail.originating_event_id).toBe(eventOne);
      }
      // Snapshot still has exactly one grant
      expect(snapshot().length).toBe(1);
    });

    it("permits independent grants when originating_event_id differs", async () => {
      const { port, snapshot } = makeInMemoryRewardPort();
      await Effect.runPromise(port.grant(rewardNone, identityA, eventOne));
      await Effect.runPromise(port.grant(rewardNone, identityA, eventTwo));
      expect(snapshot().length).toBe(2);
    });

    it("permits independent grants when recipient differs (same originating event)", async () => {
      const { port, snapshot } = makeInMemoryRewardPort();
      await Effect.runPromise(port.grant(rewardNone, identityA, eventOne));
      await Effect.runPromise(port.grant(rewardNone, identityB, eventOne));
      expect(snapshot().length).toBe(2);
    });
  });

  describe("error variants — CL-Port-2 reachability", () => {
    it("returns IdentityUnresolvable when recipient cannot be resolved", async () => {
      const { port } = makeInMemoryRewardPort({
        unresolvableIdentities: new Set([identityB]),
      });
      const fail = await Effect.runPromise(
        Effect.flip(port.grant(rewardNone, identityB, eventOne)),
      );
      expect(fail._tag).toBe("IdentityUnresolvable");
      if (fail._tag === "IdentityUnresolvable") {
        expect(fail.identity_id).toBe(identityB);
      }
    });

    it("returns GrantFailed (retryable=true) when downstream is flaky", async () => {
      const { port } = makeInMemoryRewardPort({
        failingGrants: [{ recipient: identityA, reason: "rpc-timeout", retryable: true }],
      });
      const fail = await Effect.runPromise(
        Effect.flip(port.grant(rewardNone, identityA, eventOne)),
      );
      expect(fail._tag).toBe("GrantFailed");
      if (fail._tag === "GrantFailed") {
        expect(fail.retryable).toBe(true);
        expect(fail.reason).toBe("rpc-timeout");
      }
      // After consumption, next attempt succeeds (FR-4.2 retry → granted)
      const ok = await Effect.runPromise(port.grant(rewardNone, identityA, eventOne));
      expect(ok._tag).toBe("RewardGranted");
    });

    it("returns GrantFailed (retryable=false) for terminal failures", async () => {
      const { port } = makeInMemoryRewardPort({
        failingGrants: [
          { recipient: identityA, reason: "policy-rejection", retryable: false },
        ],
      });
      const fail = await Effect.runPromise(
        Effect.flip(port.grant(rewardNone, identityA, eventOne)),
      );
      expect(fail._tag).toBe("GrantFailed");
      if (fail._tag === "GrantFailed") {
        expect(fail.retryable).toBe(false);
      }
    });

    it("returns AdapterUnavailable via simulated-failure hook", async () => {
      const { port } = makeInMemoryRewardPort({
        simulatedFailures: [{ on: "grant", reason: "db-down" }],
      });
      const fail = await Effect.runPromise(
        Effect.flip(port.grant(rewardNone, identityA, eventOne)),
      );
      expect(fail._tag).toBe("AdapterUnavailable");
    });

    it("touches all 4 RewardError variants from a single port instance", async () => {
      const { port } = makeInMemoryRewardPort({
        unresolvableIdentities: new Set([identityB]),
        failingGrants: [{ recipient: identityA, reason: "flake", retryable: true }],
        simulatedFailures: [{ on: "grant", reason: "induced" }],
      });
      const reached = new Set<string>();
      // 1. AdapterUnavailable (consumes simulated failure)
      const a = await Effect.runPromise(
        Effect.flip(port.grant(rewardNone, identityA, eventOne)),
      );
      reached.add(a._tag);
      // 2. IdentityUnresolvable
      const b = await Effect.runPromise(
        Effect.flip(port.grant(rewardNone, identityB, eventTwo)),
      );
      reached.add(b._tag);
      // 3. GrantFailed (consumes failing-grant)
      const c = await Effect.runPromise(
        Effect.flip(port.grant(rewardNone, identityA, eventOne)),
      );
      reached.add(c._tag);
      // Seed a successful grant so AlreadyGranted is reachable
      await Effect.runPromise(port.grant(rewardNone, identityA, eventOne));
      // 4. AlreadyGranted (same tuple)
      const d = await Effect.runPromise(
        Effect.flip(port.grant(rewardNone, identityA, eventOne)),
      );
      reached.add(d._tag);

      expect(reached).toEqual(
        new Set(["AdapterUnavailable", "IdentityUnresolvable", "GrantFailed", "AlreadyGranted"]),
      );
    });
  });
});
