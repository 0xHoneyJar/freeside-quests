/**
 * substrate-runtime adapter — POST loa-finn#157 binding.
 *
 * v1 (this SDD · cycle-Q sprint-2) ships a STUB returning
 * `Effect.fail(NotImplementedError)` for every operation. The compile-time
 * TYPE matches the QuestStatePort interface — when #157 lands, this adapter
 * wires to Finn's loader output + EventStore (per loa-finn#157 sprint-3
 * PAIR-POINT GREEN cross-pack Tag identity).
 *
 * The swap-shape is additive: same Tag identity (`@freeside-quests/QuestStatePort`),
 * different Layer. Bot consumer changes ZERO lines to adopt — just swap the
 * Layer at composition root.
 *
 * @future #157 — the real implementation arrives in cycle-2 close-out cycle.
 *   See loa-finn#157 sprint-3 ModelRunner Layer pattern as the reference.
 *
 * Cycle-Q · 2026-05-04 · sprint-2 ENGINE+PERSIST · SDD §4.2 + §10.
 */

import { Effect, Layer } from "effect";
import { NotImplementedError } from "@freeside-quests/protocol";

import { QuestStatePort } from "../port.js";

// ---------------------------------------------------------------------------
// Stub Layer — every op fails fast with NotImplementedError
// ---------------------------------------------------------------------------

/**
 * Substrate-runtime stub Layer.
 *
 * Every QuestStatePort verb returns `Effect.fail(NotImplementedError)` with
 * `defer_to: "loa-finn#157"`. Grep `@future #157` to find every line that
 * needs upgrading post-merge.
 */
export const QuestStatePortSubstrateRuntimeLayer = Layer.succeed(
  QuestStatePort,
  QuestStatePort.of({
    // @future #157 — wires to Finn loader-output + EventStore on cycle-2 close.
    load: () =>
      Effect.fail(
        new NotImplementedError({
          surface: "QuestStatePortSubstrateRuntimeLayer.load",
          defer_to: "loa-finn#157",
        }),
      ),
    // @future #157 — wires to Finn EventWriter Layer on cycle-2 close.
    save: () =>
      Effect.fail(
        new NotImplementedError({
          surface: "QuestStatePortSubstrateRuntimeLayer.save",
          defer_to: "loa-finn#157",
        }),
      ),
    // @future #157 — wires to Finn loader-output query path on cycle-2 close.
    list: () =>
      Effect.fail(
        new NotImplementedError({
          surface: "QuestStatePortSubstrateRuntimeLayer.list",
          defer_to: "loa-finn#157",
        }),
      ),
    // @future #157 — wires to Finn EventWriter Layer on cycle-2 close.
    delete: () =>
      Effect.fail(
        new NotImplementedError({
          surface: "QuestStatePortSubstrateRuntimeLayer.delete",
          defer_to: "loa-finn#157",
        }),
      ),
  }),
);
