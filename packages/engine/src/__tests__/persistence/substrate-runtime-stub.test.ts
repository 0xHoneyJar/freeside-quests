/**
 * substrate-runtime stub — NotImplementedError + grep-traceability.
 *
 * Per SDD §9.2 AC-2.3 + §10.1: the `// @future #157` marker on every op
 * is the upgrade-path beacon. This test asserts:
 *   1. Every QuestStatePort verb on the stub Layer yields NotImplementedError
 *      with `defer_to: "loa-finn#157"`.
 *   2. The stub source file contains 4 `// @future #157` markers (one per op).
 *
 * Cycle-Q · 2026-05-04 · sprint-2 ENGINE+PERSIST.
 */

import { describe, expect, it } from "vitest";
import { Effect, Either, Schema } from "effect";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { QuestStatePort } from "../../persistence/port.js";
import { QuestStatePortSubstrateRuntimeLayer } from "../../persistence/adapters/substrate-runtime.js";
import {
  type PlayerIdentity,
  QuestId,
  PlayerWallet,
  DiscordId,
} from "@0xhoneyjar/quests-protocol";

const QUEST_ID = Schema.decodeSync(QuestId)("quest-x-001");
const WALLET = Schema.decodeSync(PlayerWallet)(`0x${"a".repeat(40)}`);
const DISCORD = Schema.decodeSync(DiscordId)("123456789012345678");
const VERIFIED: PlayerIdentity = {
  type: "verified",
  wallet: WALLET,
  discord_id: DISCORD,
};

// ---------------------------------------------------------------------------
// Behavior: every verb fails with NotImplementedError + defer_to tag
// ---------------------------------------------------------------------------

describe("QuestStatePortSubstrateRuntimeLayer · NotImplementedError on every verb", () => {
  it("load → NotImplementedError{defer_to: loa-finn#157}", async () => {
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      return yield* port.load(QUEST_ID, VERIFIED);
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(QuestStatePortSubstrateRuntimeLayer),
        Effect.either,
      ),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("NotImplementedError");
      if (result.left._tag === "NotImplementedError") {
        expect(result.left.defer_to).toBe("loa-finn#157");
        expect(result.left.surface).toMatch(/SubstrateRuntimeLayer\.load/);
      }
    }
  });

  it("save → NotImplementedError{defer_to: loa-finn#157}", async () => {
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      yield* port.save({
        quest_id: QUEST_ID,
        player: VERIFIED,
        npc_id: "x" as never,
        phase: "browsing",
        trace_id: "trace-x",
        contract_version: "1.0.0",
      });
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(QuestStatePortSubstrateRuntimeLayer),
        Effect.either,
      ),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("NotImplementedError");
      if (result.left._tag === "NotImplementedError") {
        expect(result.left.defer_to).toBe("loa-finn#157");
      }
    }
  });

  it("list → NotImplementedError{defer_to: loa-finn#157}", async () => {
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      return yield* port.list(VERIFIED);
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(QuestStatePortSubstrateRuntimeLayer),
        Effect.either,
      ),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("NotImplementedError");
      if (result.left._tag === "NotImplementedError") {
        expect(result.left.defer_to).toBe("loa-finn#157");
      }
    }
  });

  it("delete → NotImplementedError{defer_to: loa-finn#157}", async () => {
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      yield* port.delete(QUEST_ID, VERIFIED);
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(QuestStatePortSubstrateRuntimeLayer),
        Effect.either,
      ),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("NotImplementedError");
      if (result.left._tag === "NotImplementedError") {
        expect(result.left.defer_to).toBe("loa-finn#157");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Source-grep: `// @future #157` markers traceable per SDD §10.1
// ---------------------------------------------------------------------------

describe("substrate-runtime stub source · @future #157 markers (SDD §10.1)", () => {
  it("contains a `// @future #157` marker on every op (load, save, list, delete)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sourcePath = join(
      here,
      "..",
      "..",
      "persistence",
      "adapters",
      "substrate-runtime.ts",
    );
    const source = readFileSync(sourcePath, "utf8");
    const matches = source.match(/@future #157/g) ?? [];
    // 4 verbs · plus header reference (5+ total ok).
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it("references the substrate-runtime surface (NOT another adapter)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sourcePath = join(
      here,
      "..",
      "..",
      "persistence",
      "adapters",
      "substrate-runtime.ts",
    );
    const source = readFileSync(sourcePath, "utf8");
    expect(source).toMatch(/QuestStatePortSubstrateRuntimeLayer/);
    expect(source).toMatch(/loa-finn#157/);
  });
});
