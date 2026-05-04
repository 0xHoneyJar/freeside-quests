/**
 * QuestStatePort — the single seam between engine and persistence layer.
 *
 * Per [[contracts-as-bridges]]: this Tag is the bridge that survives adapter
 * rotation. Cycle-2 substrate-runtime PR #157 binds additively via swap-shape
 * (same Tag identity, different Layer · per SDD §10).
 *
 * IDENTITY CONTRACT (architect lock A2 · SDD §10.2):
 *   The string `"@freeside-quests/QuestStatePort"` is the cross-pack key —
 *   same convention as loa-finn#157 sprint-3 PAIR-POINT GREEN's
 *   `Context.GenericTag<...>("ModelRunner")`. Adapters in different packages
 *   share this identity by referencing the exact string.
 *
 *   When loa-finn#157 lands, the substrate-runtime adapter (in a separate
 *   package) declares `Context.GenericTag<QuestStatePort>("@freeside-quests/QuestStatePort")`
 *   and Effect resolves them as the SAME Tag at composition time.
 *
 *   The cross-pack identity test (`__tests__/persistence/cross-pack-tag-identity.test.ts`)
 *   asserts the string match mechanically.
 *
 * Cycle-Q · 2026-05-04 · sprint-2 ENGINE+PERSIST · SDD §4.2.
 */

import { Context, type Effect } from "effect";
import {
  type QuestState,
  type QuestId,
  type PlayerIdentity,
  type PersistenceError,
  type QuestNotFoundError,
  type StateDecodeError,
  type NotImplementedError,
} from "@freeside-quests/protocol";

// ---------------------------------------------------------------------------
// Cross-pack Tag identity contract — load-bearing constant
// ---------------------------------------------------------------------------

/**
 * The cross-pack Tag identity string. EXACT MATCH required across packages
 * for Effect to resolve them as the same Tag.
 *
 * Architect lock A2 (SDD §1.5): this string MUST NOT change. Cycle-2's
 * substrate-runtime adapter references this exact string. Cross-pack
 * identity test asserts this is the source-of-truth value.
 */
export const QUEST_STATE_PORT_TAG_IDENTITY =
  "@freeside-quests/QuestStatePort" as const;

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

/**
 * QuestStatePort — the single seam between engine and persistence.
 *
 * 4 verbs:
 *   - `load(quest_id, player)` → QuestState | QuestNotFoundError | PersistenceError | StateDecodeError | NotImplementedError
 *   - `save(state)` → void | PersistenceError | NotImplementedError
 *   - `list(player)` → readonly QuestState[] | PersistenceError | NotImplementedError
 *   - `delete(quest_id, player)` → void | PersistenceError | NotImplementedError
 *
 * All ops are Effect-typed · errors are tagged · failures bubble through
 * the Effect chain.
 *
 * Failure modes by adapter:
 *   - memory   · QuestNotFoundError (load only) · no other failures
 *   - postgres · PersistenceError (driver) · QuestNotFoundError (load) ·
 *                StateDecodeError (load · schema drift defense)
 *   - substrate-runtime stub · NotImplementedError (every op · pre-#157)
 *
 * The NotImplementedError surface is part of the port contract because the
 * substrate-runtime stub is a first-class adapter (SDD §10) — its presence
 * in the port type lets composition-root code switch Layers without
 * touching consumer call-sites.
 */
export interface QuestStatePort {
  readonly load: (
    quest_id: QuestId,
    player: PlayerIdentity,
  ) => Effect.Effect<
    QuestState,
    | QuestNotFoundError
    | PersistenceError
    | StateDecodeError
    | NotImplementedError
  >;

  readonly save: (
    state: QuestState,
  ) => Effect.Effect<void, PersistenceError | NotImplementedError>;

  readonly list: (
    player: PlayerIdentity,
  ) => Effect.Effect<
    readonly QuestState[],
    PersistenceError | NotImplementedError
  >;

  readonly delete: (
    quest_id: QuestId,
    player: PlayerIdentity,
  ) => Effect.Effect<void, PersistenceError | NotImplementedError>;
}

// ---------------------------------------------------------------------------
// Tag declaration
// ---------------------------------------------------------------------------

/**
 * The Tag itself. Composition root resolves this against a Layer (memory ·
 * postgres · substrate-runtime stub).
 *
 * The string passed to `Context.GenericTag` IS the cross-pack identity —
 * Effect uses it to resolve Tags across module boundaries. Per A2.
 */
export const QuestStatePort = Context.GenericTag<QuestStatePort>(
  QUEST_STATE_PORT_TAG_IDENTITY,
);
