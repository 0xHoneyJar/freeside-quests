/**
 * AuthCheckPort sietch-stub — TODO swap-shape for sibling Session A.
 *
 * @future cycle-mature-freeside-operator-sprint-1 — Session A's
 *   `mature-freeside-operator` cycle ships the real adapter that consumes
 *   loa-freeside's identity substrate (`is_verified(wallet|discord_id)`
 *   query · `display_handle` resolution). This file is a Layer placeholder
 *   that fails fast so any caller wiring this Layer accidentally gets a
 *   clear runtime error, and the swap-shape is grep-traceable.
 *
 * Per SDD §4.3 + §10 swap-shape pattern: same Tag identity
 * (`@freeside-quests/AuthCheckPort`), different Layer. Bot consumer
 * changes ZERO lines to adopt — only the composition root flips Layers.
 *
 * This file lives separately from `index.ts` so the production-vs-stub
 * boundary is mechanically obvious. The default `AuthCheckPortAnonLayer`
 * (in `index.ts`) is the active Layer until Session A lands.
 *
 * Cycle-Q · 2026-05-04 · sprint-4 SEAMS · SDD §4.3.
 */

import { Effect, Layer } from "effect";

import { AuthCheckPort } from "./index.js";

// ---------------------------------------------------------------------------
// Stub Layer — every check fails fast with a structured error
// ---------------------------------------------------------------------------

/**
 * Sietch-stub Layer. Returns an `Effect.die` payload tagged for grep —
 * Session A replaces this whole Layer with one that consumes
 * loa-freeside's identity surface. The type signature is identical to
 * `AuthCheckPortAnonLayer` so consumer code is identical.
 *
 * @future cycle-mature-freeside-operator-sprint-1 — when this Layer is
 *   composed at the bot composition root, it MUST be replaced with the
 *   real Sietch adapter before deployment. The stub exists only to mark
 *   where the real adapter slots in.
 */
export const AuthCheckPortSietchStubLayer = Layer.succeed(
  AuthCheckPort,
  AuthCheckPort.of({
    check: () =>
      // @future cycle-mature-freeside-operator-sprint-1 — swap to
      //   `loaFreesideIdentityCheck(player)` once sibling adapter lands.
      Effect.die(
        new Error(
          "AuthCheckPortSietchStubLayer: Session A adapter not yet wired. " +
            "Compose `AuthCheckPortAnonLayer` (default) for now or the real " +
            "Sietch Layer when cycle-mature-freeside-operator-sprint-1 lands.",
        ),
      ),
  }),
);
