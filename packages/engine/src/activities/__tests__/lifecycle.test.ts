import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { ActivityLifecycleState } from "@0xhoneyjar/quests-protocol";

import {
  advance,
  InvalidTransition,
  isTerminal,
  legalTransitionsFrom,
  TerminalState,
} from "../lifecycle.js";

describe("activity lifecycle state machine", () => {
  describe("legal transitions (T2.7 acceptance: every valid transition works)", () => {
    const cases: ReadonlyArray<[ActivityLifecycleState, ActivityLifecycleState]> = [
      ["DEFINED", "ACTIVE"],
      ["ACTIVE", "PARTICIPATING"],
      ["ACTIVE", "EXPIRED"],
      ["PARTICIPATING", "COMPLETED"],
      ["PARTICIPATING", "EXPIRED"],
    ];
    for (const [from, to] of cases) {
      it(`advances ${from} → ${to}`, async () => {
        const result = await Effect.runPromise(advance(from, to));
        expect(result).toBe(to);
      });
    }
  });

  describe("illegal transitions (T2.7 acceptance: invalid → LifecycleError)", () => {
    const cases: ReadonlyArray<[ActivityLifecycleState, ActivityLifecycleState]> = [
      ["DEFINED", "PARTICIPATING"],
      ["DEFINED", "COMPLETED"],
      ["ACTIVE", "DEFINED"],
      ["PARTICIPATING", "ACTIVE"],
      ["ACTIVE", "COMPLETED"],
    ];
    for (const [from, to] of cases) {
      it(`rejects ${from} → ${to} with InvalidTransition`, async () => {
        const failure = await Effect.runPromise(Effect.flip(advance(from, to)));
        expect(failure._tag).toBe("InvalidTransition");
        expect(failure).toBeInstanceOf(InvalidTransition);
        if (failure._tag === "InvalidTransition") {
          expect(failure.from).toBe(from);
          expect(failure.to).toBe(to);
        }
      });
    }
  });

  describe("terminal states (T2.7 acceptance: EXPIRED is terminal)", () => {
    it("COMPLETED is terminal — advance fails with TerminalState", async () => {
      const failure = await Effect.runPromise(Effect.flip(advance("COMPLETED", "EXPIRED")));
      expect(failure._tag).toBe("TerminalState");
      expect(failure).toBeInstanceOf(TerminalState);
    });

    it("EXPIRED is terminal — advance fails with TerminalState", async () => {
      const failure = await Effect.runPromise(Effect.flip(advance("EXPIRED", "COMPLETED")));
      expect(failure._tag).toBe("TerminalState");
    });

    it("isTerminal returns true for COMPLETED + EXPIRED only", () => {
      expect(isTerminal("DEFINED")).toBe(false);
      expect(isTerminal("ACTIVE")).toBe(false);
      expect(isTerminal("PARTICIPATING")).toBe(false);
      expect(isTerminal("COMPLETED")).toBe(true);
      expect(isTerminal("EXPIRED")).toBe(true);
    });
  });

  describe("no backwards transitions (T2.7 acceptance)", () => {
    const backwards: ReadonlyArray<[ActivityLifecycleState, ActivityLifecycleState]> = [
      ["ACTIVE", "DEFINED"],
      ["PARTICIPATING", "ACTIVE"],
      ["PARTICIPATING", "DEFINED"],
    ];
    for (const [from, to] of backwards) {
      it(`refuses backwards ${from} → ${to}`, async () => {
        const failure = await Effect.runPromise(Effect.flip(advance(from, to)));
        expect(failure._tag).toBe("InvalidTransition");
      });
    }
  });

  describe("legalTransitionsFrom snapshot", () => {
    it("DEFINED → {ACTIVE}", () => {
      expect([...legalTransitionsFrom("DEFINED")]).toEqual(["ACTIVE"]);
    });
    it("ACTIVE → {PARTICIPATING, EXPIRED}", () => {
      expect(new Set(legalTransitionsFrom("ACTIVE"))).toEqual(
        new Set(["PARTICIPATING", "EXPIRED"]),
      );
    });
    it("PARTICIPATING → {COMPLETED, EXPIRED}", () => {
      expect(new Set(legalTransitionsFrom("PARTICIPATING"))).toEqual(
        new Set(["COMPLETED", "EXPIRED"]),
      );
    });
    it("COMPLETED + EXPIRED have no successors", () => {
      expect(legalTransitionsFrom("COMPLETED").size).toBe(0);
      expect(legalTransitionsFrom("EXPIRED").size).toBe(0);
    });
  });
});
