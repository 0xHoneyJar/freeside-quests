/**
 * Memory adapter — in-process Map Layer for QuestStatePort.
 *
 * RESTART LOSES STATE. Use for dev/test only · production = postgres.
 *
 * Per SDD §4.2: composeKey handles the verified-vs-anon discriminated
 * union (per-player composite key) and gives the adapter a single
 * string keyspace for `Map`.
 *
 * Cycle-Q · 2026-05-04 · sprint-2 ENGINE+PERSIST.
 */

import { Effect, Layer, Ref } from "effect";
import {
  type QuestState,
  type QuestId,
  type PlayerIdentity,
  QuestNotFoundError,
} from "@freeside-quests/protocol";

import { QuestStatePort } from "../port.js";

// ---------------------------------------------------------------------------
// Composite key — verified-OR-anon → string
// ---------------------------------------------------------------------------

/**
 * Compose a single string key from a (quest_id, player) tuple. Verified
 * players key on `wallet:0x...`; anon players key on `discord:<snowflake>`.
 *
 * Exported for adapter test harnesses + the postgres adapter (which uses
 * the same key shape for its `player_key` column · per SDD §4.2 postgres
 * Schema box).
 */
export const composeKey = (quest_id: QuestId, player: PlayerIdentity): string => {
  const playerKey =
    player.type === "verified"
      ? `wallet:${player.wallet}`
      : `discord:${player.discord_id}`;
  return `${quest_id}|${playerKey}`;
};

// ---------------------------------------------------------------------------
// Player-match predicate (used by list)
// ---------------------------------------------------------------------------

const playerMatches = (a: PlayerIdentity, b: PlayerIdentity): boolean => {
  if (a.type !== b.type) return false;
  if (a.type === "verified" && b.type === "verified") {
    return a.wallet === b.wallet;
  }
  if (a.type === "anon" && b.type === "anon") {
    return a.discord_id === b.discord_id;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Memory Layer
// ---------------------------------------------------------------------------

/**
 * In-process Map<key, QuestState>. Each Layer instantiation creates a
 * NEW Ref · so `Layer.provide(memoryLayer)` to two different programs
 * yields two isolated stores. For a shared store across programs, share
 * the Layer reference itself.
 */
export const QuestStatePortMemoryLayer = Layer.effect(
  QuestStatePort,
  Effect.gen(function* () {
    const store = yield* Ref.make<Map<string, QuestState>>(new Map());

    return QuestStatePort.of({
      load: (quest_id, player) =>
        Ref.get(store).pipe(
          Effect.flatMap((map) => {
            const state = map.get(composeKey(quest_id, player));
            return state === undefined
              ? Effect.fail(new QuestNotFoundError({ quest_id }))
              : Effect.succeed(state);
          }),
        ),

      save: (state) =>
        Ref.update(store, (map) => {
          const next = new Map(map);
          next.set(composeKey(state.quest_id, state.player), state);
          return next;
        }),

      list: (player) =>
        Ref.get(store).pipe(
          Effect.map((map) => {
            const out: QuestState[] = [];
            for (const state of map.values()) {
              if (playerMatches(state.player, player)) {
                out.push(state);
              }
            }
            return out;
          }),
        ),

      delete: (quest_id, player) =>
        Ref.update(store, (map) => {
          const next = new Map(map);
          next.delete(composeKey(quest_id, player));
          return next;
        }),
    });
  }),
);
