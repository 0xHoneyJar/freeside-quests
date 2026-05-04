/**
 * @freeside-quests/engine — headless quest engine.
 *
 * Cycle-1 (2026-05-03) lands the substrate-step dispatch bridging
 * (Plane-3 gateway/listener logic).
 *
 * Cycle-Q (2026-05-04) lands the quest UI substrate engine layer:
 *   - Pure transition functions (`accept` · `submit` · `judge` · `finalize`)
 *     and the `transitions` aggregate
 *   - `QuestStatePort` Tag + cross-pack identity contract
 *   - Three persistence adapters:
 *       · QuestStatePortMemoryLayer  · dev/test default
 *       · QuestStatePortPostgresLayer · production default (per-world DBs)
 *       · QuestStatePortSubstrateRuntimeLayer · post-#157 stub
 *
 * Sprint-4 will land:
 *   - AuthCheckPort (anon-allowed default · sietch-stub Layer placeholder)
 *   - BadgeIssuancePort (null-badge default · asset-pipeline-stub Layer)
 *   - EngineConfig (3-mode questAcceptanceMode enum · per-world Slug)
 *   - End-to-end stub-quest integration test
 */

// ---------------------------------------------------------------------------
// Cycle-1 (substrate-step dispatch · 2026-05-03)
// ---------------------------------------------------------------------------

export {
  dispatchEssayQuest,
  dispatchAndResolve,
  resolveVerdict,
  DispatchError,
  type EssayGraderInput,
  type EssayGraderOutput,
  type ResolutionHandlers,
} from "./dispatch.js";

// ---------------------------------------------------------------------------
// Cycle-Q (quest UI substrate engine · 2026-05-04 · SDD §4)
// ---------------------------------------------------------------------------

// State machine (§4.1) — pure transitions
export {
  accept,
  submit,
  judge,
  finalize,
  transitions,
  systemClock,
  type Clock,
} from "./quest-state-machine.js";

// Persistence port + Tag identity (§4.2)
export {
  QuestStatePort,
  QUEST_STATE_PORT_TAG_IDENTITY,
} from "./persistence/port.js";

// Persistence adapters (§4.2)
export {
  QuestStatePortMemoryLayer,
  composeKey,
} from "./persistence/adapters/memory.js";
export {
  QuestStatePortPostgresLayer,
  type PostgresAdapterConfig,
  type QuestStatePostgresPool,
  type QueryResultRow,
} from "./persistence/adapters/postgres.js";
export { QuestStatePortSubstrateRuntimeLayer } from "./persistence/adapters/substrate-runtime.js";
