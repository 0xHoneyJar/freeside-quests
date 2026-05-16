/**
 * RewardPort conformance suite as a factory function
 * (sprint-2 review C3 · Fix-S5 reusable black-box).
 *
 * Adapter authors import `runRewardPortConformanceSuite` and pass a factory
 * that returns a fresh `RewardPort` (plus optional helpers for failure
 * injection). The same `describe`/`it` blocks run against the adapter.
 *
 * Factory contract:
 *   - returns a `{ port, snapshot? }` bundle
 *   - bundle MUST be freshly-allocated per call (independent grant store)
 *   - the optional `failingGrantsFactory` / `unresolvableIdentitiesFactory`
 *     hooks let scenarios reach the GrantFailed / IdentityUnresolvable
 *     variants without forcing every adapter to ship them — adapters that
 *     can't simulate failures should mark those scenarios as `.skip` in
 *     their wrapper.
 */
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  type ActivityReward,
  ActivityRewardNone,
  EventId,
  IdentityId,
  type RewardGranted,
  type RewardPort,
} from "@0xhoneyjar/quests-protocol";

type RewardGrantedRecord = Schema.Schema.Type<typeof RewardGranted>;

export interface RewardPortConformanceBundle {
  readonly port: RewardPort;
  readonly snapshot?: () => ReadonlyArray<RewardGrantedRecord>;
}

export interface RewardPortConformanceFactoryConfig {
  readonly unresolvableIdentities?: ReadonlySet<IdentityId>;
  readonly failingGrants?: ReadonlyArray<{
    readonly recipient: IdentityId;
    readonly reason: string;
    readonly retryable: boolean;
  }>;
  readonly simulatedFailures?: ReadonlyArray<{
    readonly on: "grant" | "query" | "any";
    readonly reason: string;
  }>;
}

export type RewardPortConformanceFactory = (
  config?: RewardPortConformanceFactoryConfig,
) => RewardPortConformanceBundle;

const decode = Schema.decodeUnknownSync;

const fixtures = {
  identityA: decode(IdentityId)("id_a"),
  identityB: decode(IdentityId)("id_b"),
  eventOne: decode(EventId)("a".repeat(64)),
  eventTwo: decode(EventId)("b".repeat(64)),
  rewardNone: ActivityRewardNone.make({}) as ActivityReward,
};

/**
 * runRewardPortConformanceSuite — black-box conformance gate for RewardPort
 * implementations (T2.4 + T2.4b).
 *
 * Adapters MUST pass:
 *   - happy path: grant returns RewardGranted; query returns granted records
 *   - D18 idempotency: duplicate tuple → AlreadyGranted carrying existing grant
 *   - CL-Port-2 variant reachability: every RewardError variant reachable
 */
export const runRewardPortConformanceSuite = (
  factory: RewardPortConformanceFactory,
  adapterName: string,
): void => {
  describe(`RewardPort conformance — ${adapterName}`, () => {
    describe("happy path", () => {
      it("grants a reward and returns RewardGranted", async () => {
        const { port } = factory();
        const result = await Effect.runPromise(
          port.grant(fixtures.rewardNone, fixtures.identityA, fixtures.eventOne),
        );
        expect(result._tag).toBe("RewardGranted");
        expect(result.originating_event_id).toBe(fixtures.eventOne);
      });

      it("query returns granted rewards per identity", async () => {
        const { port } = factory();
        await Effect.runPromise(
          port.grant(fixtures.rewardNone, fixtures.identityA, fixtures.eventOne),
        );
        await Effect.runPromise(
          port.grant(fixtures.rewardNone, fixtures.identityA, fixtures.eventTwo),
        );
        const records = await Effect.runPromise(port.query(fixtures.identityA));
        expect(records.length).toBe(2);
      });
    });

    describe("CL-Reward-2 — D18 idempotency", () => {
      it("duplicate tuple → AlreadyGranted (carries existing grant id)", async () => {
        const { port } = factory();
        const first = await Effect.runPromise(
          port.grant(fixtures.rewardNone, fixtures.identityA, fixtures.eventOne),
        );
        const dup = await Effect.runPromise(
          Effect.flip(
            port.grant(fixtures.rewardNone, fixtures.identityA, fixtures.eventOne),
          ),
        );
        expect(dup._tag).toBe("AlreadyGranted");
        if (dup._tag === "AlreadyGranted") {
          expect(dup.existing_grant_id).toBe(first.granted_event_id);
        }
      });

      it("different originating_event_id → independent grants", async () => {
        const { port } = factory();
        await Effect.runPromise(
          port.grant(fixtures.rewardNone, fixtures.identityA, fixtures.eventOne),
        );
        await Effect.runPromise(
          port.grant(fixtures.rewardNone, fixtures.identityA, fixtures.eventTwo),
        );
        const records = await Effect.runPromise(port.query(fixtures.identityA));
        expect(records.length).toBe(2);
      });
    });

    describe("CL-Port-2 — every RewardError variant is reachable", () => {
      it("touches all 4 RewardError variants from a single port instance", async () => {
        const { port } = factory({
          unresolvableIdentities: new Set([fixtures.identityB]),
          failingGrants: [
            { recipient: fixtures.identityA, reason: "flake", retryable: true },
          ],
          simulatedFailures: [{ on: "grant", reason: "induced" }],
        });
        const reached = new Set<string>();
        const a = await Effect.runPromise(
          Effect.flip(port.grant(fixtures.rewardNone, fixtures.identityA, fixtures.eventOne)),
        );
        reached.add(a._tag);
        const b = await Effect.runPromise(
          Effect.flip(port.grant(fixtures.rewardNone, fixtures.identityB, fixtures.eventTwo)),
        );
        reached.add(b._tag);
        const c = await Effect.runPromise(
          Effect.flip(port.grant(fixtures.rewardNone, fixtures.identityA, fixtures.eventOne)),
        );
        reached.add(c._tag);
        await Effect.runPromise(
          port.grant(fixtures.rewardNone, fixtures.identityA, fixtures.eventOne),
        );
        const d = await Effect.runPromise(
          Effect.flip(port.grant(fixtures.rewardNone, fixtures.identityA, fixtures.eventOne)),
        );
        reached.add(d._tag);
        expect(reached).toEqual(
          new Set(["AdapterUnavailable", "IdentityUnresolvable", "GrantFailed", "AlreadyGranted"]),
        );
      });
    });
  });
};
