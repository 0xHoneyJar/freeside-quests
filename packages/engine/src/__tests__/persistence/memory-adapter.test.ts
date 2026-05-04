/**
 * Memory adapter — full load/save/list/delete coverage.
 *
 * Per SDD §9.2 AC-2.4 (memory part): every adapter verb exercised, error
 * paths asserted, idempotency proven, player-keyspace isolation proven.
 *
 * Cycle-Q · 2026-05-04 · sprint-2 ENGINE+PERSIST.
 */

import { describe, expect, it } from "vitest";
import { Effect, Either, Schema } from "effect";

import {
  QuestStatePort,
} from "../../persistence/port.js";
import {
  QuestStatePortMemoryLayer,
  composeKey,
} from "../../persistence/adapters/memory.js";
import {
  type QuestState,
  type PlayerIdentity,
  QuestId,
  NpcId,
  PlayerWallet,
  DiscordId,
} from "@0xhoneyjar/quests-protocol";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const QUEST_ID = Schema.decodeSync(QuestId)("quest-mongolian-001");
const QUEST_ID_2 = Schema.decodeSync(QuestId)("quest-satoshi-001");
const NPC_ID = Schema.decodeSync(NpcId)("mongolian");
const WALLET_A = Schema.decodeSync(PlayerWallet)(`0x${"a".repeat(40)}`);
const WALLET_B = Schema.decodeSync(PlayerWallet)(`0x${"b".repeat(40)}`);
const DISCORD_A = Schema.decodeSync(DiscordId)("123456789012345678");
const DISCORD_B = Schema.decodeSync(DiscordId)("234567890123456789");

const VERIFIED_A: PlayerIdentity = {
  type: "verified",
  wallet: WALLET_A,
  discord_id: DISCORD_A,
};
const VERIFIED_B: PlayerIdentity = {
  type: "verified",
  wallet: WALLET_B,
  discord_id: DISCORD_B,
};
const ANON_A: PlayerIdentity = { type: "anon", discord_id: DISCORD_A };
const ANON_B: PlayerIdentity = { type: "anon", discord_id: DISCORD_B };

const stateFor = (
  quest_id: typeof QUEST_ID,
  player: PlayerIdentity,
  overrides: Partial<QuestState> = {},
): QuestState => ({
  quest_id,
  player,
  npc_id: NPC_ID,
  phase: "browsing",
  trace_id: "trace-mem-test",
  contract_version: "1.0.0",
  ...overrides,
});

// ---------------------------------------------------------------------------
// composeKey — pure helper coverage
// ---------------------------------------------------------------------------

describe("composeKey", () => {
  it("composes a verified player into wallet:<addr> form", () => {
    expect(composeKey(QUEST_ID, VERIFIED_A)).toBe(`${QUEST_ID}|wallet:${WALLET_A}`);
  });

  it("composes an anon player into discord:<id> form", () => {
    expect(composeKey(QUEST_ID, ANON_A)).toBe(`${QUEST_ID}|discord:${DISCORD_A}`);
  });

  it("yields a different key for verified vs anon with the same discord_id", () => {
    expect(composeKey(QUEST_ID, VERIFIED_A)).not.toBe(composeKey(QUEST_ID, ANON_A));
  });

  it("yields a different key for the same player on different quests", () => {
    expect(composeKey(QUEST_ID, VERIFIED_A)).not.toBe(composeKey(QUEST_ID_2, VERIFIED_A));
  });
});

// ---------------------------------------------------------------------------
// load · save · list · delete via Layer
// ---------------------------------------------------------------------------

describe("QuestStatePortMemoryLayer", () => {
  it("save then load round-trips a state for a verified player", async () => {
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      const state = stateFor(QUEST_ID, VERIFIED_A);
      yield* port.save(state);
      return yield* port.load(QUEST_ID, VERIFIED_A);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(QuestStatePortMemoryLayer)),
    );
    expect(result.quest_id).toBe(QUEST_ID);
    expect(result.player).toEqual(VERIFIED_A);
    expect(result.phase).toBe("browsing");
  });

  it("save then load round-trips a state for an anon player", async () => {
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      yield* port.save(stateFor(QUEST_ID, ANON_A, { phase: "accepted" }));
      return yield* port.load(QUEST_ID, ANON_A);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(QuestStatePortMemoryLayer)),
    );
    expect(result.player).toEqual(ANON_A);
    expect(result.phase).toBe("accepted");
  });

  it("load fails with QuestNotFoundError when no state for (quest, player)", async () => {
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      return yield* port.load(QUEST_ID, VERIFIED_A);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(QuestStatePortMemoryLayer), Effect.either),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("QuestNotFoundError");
      if (result.left._tag === "QuestNotFoundError") {
        expect(result.left.quest_id).toBe(QUEST_ID);
      }
    }
  });

  it("save is idempotent — second save with same key updates in-place", async () => {
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      const initial = stateFor(QUEST_ID, VERIFIED_A, { phase: "browsing" });
      yield* port.save(initial);
      const updated: QuestState = { ...initial, phase: "accepted" };
      yield* port.save(updated);
      const list = yield* port.list(VERIFIED_A);
      const loaded = yield* port.load(QUEST_ID, VERIFIED_A);
      return { listLen: list.length, loadedPhase: loaded.phase };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(QuestStatePortMemoryLayer)),
    );
    expect(result.listLen).toBe(1);
    expect(result.loadedPhase).toBe("accepted");
  });

  it("list returns only states for the requested player (verified isolation)", async () => {
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      yield* port.save(stateFor(QUEST_ID, VERIFIED_A));
      yield* port.save(stateFor(QUEST_ID_2, VERIFIED_A, { phase: "accepted" }));
      yield* port.save(stateFor(QUEST_ID, VERIFIED_B));
      yield* port.save(stateFor(QUEST_ID, ANON_A));
      return yield* port.list(VERIFIED_A);
    });

    const list = await Effect.runPromise(
      program.pipe(Effect.provide(QuestStatePortMemoryLayer)),
    );
    expect(list.length).toBe(2);
    expect(list.every((s) => s.player.type === "verified")).toBe(true);
    if (list[0]?.player.type === "verified" && list[1]?.player.type === "verified") {
      expect(list[0].player.wallet).toBe(WALLET_A);
      expect(list[1].player.wallet).toBe(WALLET_A);
    }
  });

  it("list returns only states for the requested anon player (anon isolation)", async () => {
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      yield* port.save(stateFor(QUEST_ID, ANON_A));
      yield* port.save(stateFor(QUEST_ID, ANON_B));
      yield* port.save(stateFor(QUEST_ID, VERIFIED_A));
      return yield* port.list(ANON_A);
    });

    const list = await Effect.runPromise(
      program.pipe(Effect.provide(QuestStatePortMemoryLayer)),
    );
    expect(list.length).toBe(1);
    expect(list[0]?.player.type).toBe("anon");
    if (list[0]?.player.type === "anon") {
      expect(list[0].player.discord_id).toBe(DISCORD_A);
    }
  });

  it("list does NOT confuse verified and anon discord_ids that share the same value", async () => {
    // VERIFIED_A and ANON_A share DISCORD_A · keyspace MUST keep them separate.
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      yield* port.save(stateFor(QUEST_ID, VERIFIED_A, { phase: "browsing" }));
      yield* port.save(stateFor(QUEST_ID, ANON_A, { phase: "submitted" }));
      const verifiedList = yield* port.list(VERIFIED_A);
      const anonList = yield* port.list(ANON_A);
      return { verifiedList, anonList };
    });

    const { verifiedList, anonList } = await Effect.runPromise(
      program.pipe(Effect.provide(QuestStatePortMemoryLayer)),
    );
    expect(verifiedList.length).toBe(1);
    expect(verifiedList[0]?.phase).toBe("browsing");
    expect(anonList.length).toBe(1);
    expect(anonList[0]?.phase).toBe("submitted");
  });

  it("list returns empty array when no states match", async () => {
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      return yield* port.list(VERIFIED_A);
    });

    const list = await Effect.runPromise(
      program.pipe(Effect.provide(QuestStatePortMemoryLayer)),
    );
    expect(list).toEqual([]);
  });

  it("delete removes a (quest, player) entry · subsequent load fails", async () => {
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      yield* port.save(stateFor(QUEST_ID, VERIFIED_A));
      yield* port.delete(QUEST_ID, VERIFIED_A);
      return yield* Effect.either(port.load(QUEST_ID, VERIFIED_A));
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(QuestStatePortMemoryLayer)),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("QuestNotFoundError");
    }
  });

  it("delete is idempotent · deleting nonexistent key is a no-op success", async () => {
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      yield* port.delete(QUEST_ID, VERIFIED_A); // never saved
      return yield* port.list(VERIFIED_A);
    });

    const list = await Effect.runPromise(
      program.pipe(Effect.provide(QuestStatePortMemoryLayer)),
    );
    expect(list).toEqual([]);
  });

  it("delete removes only the targeted entry · sibling entries survive", async () => {
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      yield* port.save(stateFor(QUEST_ID, VERIFIED_A));
      yield* port.save(stateFor(QUEST_ID_2, VERIFIED_A));
      yield* port.delete(QUEST_ID, VERIFIED_A);
      return yield* port.list(VERIFIED_A);
    });

    const list = await Effect.runPromise(
      program.pipe(Effect.provide(QuestStatePortMemoryLayer)),
    );
    expect(list.length).toBe(1);
    expect(list[0]?.quest_id).toBe(QUEST_ID_2);
  });

  it("Layer instances are isolated · two providings yield independent stores", async () => {
    const programA = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      yield* port.save(stateFor(QUEST_ID, VERIFIED_A));
      return yield* port.list(VERIFIED_A);
    });

    const programB = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      // Independent Layer · should NOT see programA's save.
      return yield* port.list(VERIFIED_A);
    });

    const listA = await Effect.runPromise(
      programA.pipe(Effect.provide(QuestStatePortMemoryLayer)),
    );
    const listB = await Effect.runPromise(
      programB.pipe(Effect.provide(QuestStatePortMemoryLayer)),
    );
    expect(listA.length).toBe(1);
    expect(listB.length).toBe(0);
  });
});
