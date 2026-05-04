-- Quest State migration — Cycle Q sprint-2 ENGINE+PERSIST.
--
-- Per SDD §4.2 postgres adapter + §9.2 AC-2.4 closing.
-- Operator runs this against per-world Railway DBs:
--   · mibera-db
--   · apdao-db
--   · cubquest-db
--
-- Roll-forward only · additive · NO destructive changes. Safe to re-run
-- (CREATE TABLE/INDEX IF NOT EXISTS).
--
-- Schema rationale:
--   · `quest_id` + `player_key` form the composite primary key. `player_key`
--     is the result of `composeKey(quest_id, player)` from
--     `packages/engine/src/persistence/adapters/memory.ts` — verified
--     players key on `wallet:0x...` · anon players key on `discord:<id>`.
--   · `state_json` is the full sealed `QuestState` shape (per
--     `@freeside-quests/protocol`). The adapter round-trips it through
--     `Schema.decodeUnknown` on load · defense-in-depth against drift.
--   · `phase` is denormalized for query convenience (e.g. partial index).
--   · `world_slug` is denormalized for cross-world auditing in shared DBs
--     (per PRD D5 each world has its own DB · this column is informational).
--
-- Cycle-Q · 2026-05-04.

CREATE TABLE IF NOT EXISTS quest_state (
  quest_id     TEXT NOT NULL,
  player_key   TEXT NOT NULL,
  state_json   JSONB NOT NULL,
  world_slug   TEXT NOT NULL,
  phase        TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (quest_id, player_key)
);

-- Player-key index covers `list(player)` queries (SUFFIX LIKE `%|wallet:...`).
CREATE INDEX IF NOT EXISTS idx_quest_state_player
  ON quest_state(player_key);

-- Phase index covers operator queues (e.g. NEEDS_HUMAN review batches).
-- Partial index excludes terminal `completed` rows · keeps the index small.
CREATE INDEX IF NOT EXISTS idx_quest_state_phase
  ON quest_state(phase) WHERE phase != 'completed';

-- World-slug index covers per-world auditing (cross-world DBs would benefit;
-- per-world DBs treat this as cheap).
CREATE INDEX IF NOT EXISTS idx_quest_state_world
  ON quest_state(world_slug);
