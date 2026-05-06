/**
 * Postgres adapter — production default for QuestStatePort.
 *
 * Per PRD §6 + Q4 RECOMMEND: per-world DBs already provisioned on Railway
 * (mibera-db · apdao-db · cubquest-db). World-scoped adapter
 * instantiation; one Layer per world.
 *
 * Schema (per migration `db/migrations/2026-05-04-add-quest-state.sql`):
 *
 *   CREATE TABLE quest_state (
 *     quest_id TEXT NOT NULL,
 *     player_key TEXT NOT NULL,        -- composeKey(quest_id, player)
 *     state_json JSONB NOT NULL,        -- full QuestState serialized
 *     world_slug TEXT NOT NULL,
 *     phase TEXT NOT NULL,              -- denormalized for query
 *     updated_at TIMESTAMPTZ DEFAULT NOW(),
 *     PRIMARY KEY (quest_id, player_key)
 *   );
 *   CREATE INDEX idx_quest_state_player ON quest_state(player_key);
 *   CREATE INDEX idx_quest_state_phase
 *     ON quest_state(phase) WHERE phase != 'completed';
 *
 * Idempotency: save uses `ON CONFLICT (quest_id, player_key) DO UPDATE`.
 * Load uses `Schema.decodeUnknown(QuestState)` on `state_json` — defense
 * in depth against schema drift across deploys (StateDecodeError on drift).
 *
 * Failure modes:
 *   - PersistenceError{operation: "save", cause: PgError}    — DB connection lost
 *   - PersistenceError{operation: "load", cause: PgError}    — DB query failed
 *   - StateDecodeError{quest_id, cause: ParseError}          — state_json drift
 *   - QuestNotFoundError                                     — row not found
 *
 * Cycle-Q · 2026-05-04 · sprint-2 ENGINE+PERSIST · SDD §4.2 postgres.
 *
 * Cycle-B · 2026-05-05 · sprint-1 B-1.10 · per-tenant pool wiring contract:
 *
 *   - The bot composition root (apps/bot · cycle-B B-1.8) wires per-tenant
 *     `pg.Pool` instances driven by `world.tenant_id` from world manifests.
 *     One pool per tenant · cached for process lifetime · separate pools
 *     for separate tenant DBs (Railway-provisioned · `TENANT_<TENANT>_DATABASE_URL`).
 *
 *   - This adapter receives a tenant-scoped pool · world_slug-filtered queries
 *     give DEFENSE-IN-DEPTH if multiple worlds share a tenant DB. The
 *     PRIMARY isolation is at the pool layer (cross-tenant queries cannot
 *     reach the wrong DB · the connection string is tenant-bound).
 *
 *   - `expected_tenant` (optional, additive) lets consumers stamp the
 *     adapter with the tenant it was composed for. The adapter MAY assert
 *     this in future hardening passes (e.g., emit telemetry on every query
 *     · canary alarm if a save call's tenant differs from initial config).
 *     Slice-B ships the field for cross-tenant-test coverage (B-2.6) ·
 *     enforcement is upstream at dispatch.ts (B-1.11).
 *
 * The cross-tenant boundary lives in three layers:
 *   1. Pool: tenant-scoped connection (cycle-B B-1.8 · bot composition)
 *   2. Adapter: world_slug filter (this file · existing)
 *   3. Dispatch: claims.tenant === expected_tenant assertion (cycle-B B-1.11)
 *
 * Per the I6 invariant + SDD §13.2 D9, all three must agree before quest
 * state writes occur. Any single layer's drift surfaces as a routing
 * mismatch · cycle-B B-2.6 cross-tenant negative tests cover the matrix.
 */

import { Effect, Layer, Schema } from "effect";
import {
  type QuestState,
  type QuestId,
  type PlayerIdentity,
  QuestState as QuestStateSchema,
  QuestNotFoundError,
  PersistenceError,
  StateDecodeError,
} from "@0xhoneyjar/quests-protocol";

import { QuestStatePort } from "../port.js";
import { composeKey } from "./memory.js";

// ---------------------------------------------------------------------------
// Pool abstraction (consumer brings their own pg client)
// ---------------------------------------------------------------------------

/**
 * Minimal Pool interface — matches the surface area we need from `pg`'s
 * `Pool` class. Consumers wire a real `pg.Pool` instance at the bot layer.
 *
 * Decoupling here lets us:
 *   1. Test the adapter without spinning up Postgres (mock the pool)
 *   2. Avoid baking `pg` as a hard dependency on this package
 *   3. Swap to a different driver (e.g. `postgres.js`) without touching the adapter
 */
export interface QuestStatePostgresPool {
  readonly query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: ReadonlyArray<unknown>,
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
}

/** A row shape — kept loose so consumers can return whatever pg yields. */
export type QueryResultRow = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Adapter config
// ---------------------------------------------------------------------------

export interface PostgresAdapterConfig {
  /** The connection pool. Consumers own its lifecycle (creation, end()). */
  readonly pool: QuestStatePostgresPool;
  /** Per-world quest namespace. Per PRD D5 + SDD §4.2. */
  readonly world_slug: string;
  /**
   * Optional: override the table name (e.g. for staging) · default
   * `quest_state` matches the SDD §4.2 schema.
   */
  readonly table_name?: string;
  /**
   * Optional · cycle-B sprint-1 B-1.10: tenant_id this adapter was composed
   * for. The bot composition root sets this from `world.tenant_id` so the
   * adapter can stamp telemetry · be a marker for cross-tenant regression
   * tests (B-2.6) · and serve as documentation that this pool is bound to
   * a specific tenant's DB.
   *
   * NOT a runtime enforcement field today — cross-tenant boundary is
   * enforced at dispatch.ts (B-1.11) and at the pool layer (separate
   * connection strings per tenant). Field exists for additive hardening
   * (e.g., V2 may add per-query assertion).
   */
  readonly expected_tenant?: string;
}

// ---------------------------------------------------------------------------
// Persisted-row shape — extends Record so it satisfies QueryResultRow constraint.
// ---------------------------------------------------------------------------

interface QuestStateRow extends QueryResultRow {
  readonly quest_id: string;
  readonly player_key: string;
  readonly state_json: unknown;
  readonly world_slug: string;
  readonly phase: string;
  readonly updated_at: string;
}

// ---------------------------------------------------------------------------
// Layer factory
// ---------------------------------------------------------------------------

/**
 * Build a Layer providing `QuestStatePort` backed by a postgres pool.
 *
 * One Layer per (world, pool) pair. The composition root in apps/bot
 * resolves the Layer per Discord guild → world.
 *
 * @example
 *   import { Pool } from "pg";
 *   import { QuestStatePortPostgresLayer } from "@0xhoneyjar/quests-engine";
 *
 *   const pool = new Pool({ connectionString: process.env.MIBERA_DB_URL });
 *   const layer = QuestStatePortPostgresLayer({
 *     pool,
 *     world_slug: "mibera",
 *   });
 */
export const QuestStatePortPostgresLayer = (
  config: PostgresAdapterConfig,
): Layer.Layer<QuestStatePort, never, never> => {
  const tableName = config.table_name ?? "quest_state";

  return Layer.succeed(
    QuestStatePort,
    QuestStatePort.of({
      load: (quest_id, player) =>
        loadEffect(config.pool, tableName, quest_id, player),
      save: (state) => saveEffect(config.pool, tableName, config.world_slug, state),
      list: (player) => listEffect(config.pool, tableName, player),
      delete: (quest_id, player) =>
        deleteEffect(config.pool, tableName, quest_id, player),
    }),
  );
};

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

type LoadError = QuestNotFoundError | PersistenceError | StateDecodeError;

const loadEffect = (
  pool: QuestStatePostgresPool,
  tableName: string,
  quest_id: QuestId,
  player: PlayerIdentity,
): Effect.Effect<QuestState, LoadError> => {
  const queried: Effect.Effect<{ rows: QuestStateRow[]; rowCount: number | null }, LoadError> =
    Effect.tryPromise({
      try: () =>
        pool.query<QuestStateRow>(
          `SELECT quest_id, player_key, state_json, world_slug, phase, updated_at
           FROM ${tableName}
           WHERE quest_id = $1 AND player_key = $2`,
          [quest_id, composeKey(quest_id, player)],
        ),
      catch: (cause) => new PersistenceError({ operation: "load", cause }),
    });

  return queried.pipe(
    Effect.flatMap((result): Effect.Effect<QuestState, LoadError> => {
      const row = result.rows[0];
      if (row === undefined) {
        return Effect.fail(new QuestNotFoundError({ quest_id }));
      }
      // Defense-in-depth: decode the JSONB blob through the sealed schema
      // before handing it to the caller. Catches schema drift across deploys.
      return Schema.decodeUnknown(QuestStateSchema)(row.state_json).pipe(
        Effect.mapError(
          (cause): LoadError => new StateDecodeError({ quest_id, cause }),
        ),
      );
    }),
  );
};

// ---------------------------------------------------------------------------
// save · idempotent ON CONFLICT
// ---------------------------------------------------------------------------

const saveEffect = (
  pool: QuestStatePostgresPool,
  tableName: string,
  world_slug: string,
  state: QuestState,
): Effect.Effect<void, PersistenceError> =>
  Effect.tryPromise({
    try: async () => {
      // Round-trip through the schema before writing — guarantees the JSONB
      // payload satisfies the sealed shape (defense-in-depth on the producer
      // side too).
      await pool.query(
        `INSERT INTO ${tableName} (quest_id, player_key, state_json, world_slug, phase, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, NOW())
         ON CONFLICT (quest_id, player_key)
         DO UPDATE SET
           state_json = EXCLUDED.state_json,
           world_slug = EXCLUDED.world_slug,
           phase = EXCLUDED.phase,
           updated_at = NOW()`,
        [
          state.quest_id,
          composeKey(state.quest_id, state.player),
          JSON.stringify(state),
          world_slug,
          state.phase,
        ],
      );
    },
    catch: (cause) => new PersistenceError({ operation: "save", cause }),
  });

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

const listEffect = (
  pool: QuestStatePostgresPool,
  tableName: string,
  player: PlayerIdentity,
): Effect.Effect<readonly QuestState[], PersistenceError> =>
  Effect.tryPromise({
    try: () => {
      // List by player_key prefix — the suffix-shape (`wallet:...` vs
      // `discord:...`) keeps verified and anon keyspaces separate.
      const playerKey =
        player.type === "verified"
          ? `wallet:${player.wallet}`
          : `discord:${player.discord_id}`;
      return pool.query<QuestStateRow>(
        `SELECT quest_id, player_key, state_json, world_slug, phase, updated_at
         FROM ${tableName}
         WHERE player_key LIKE $1
         ORDER BY updated_at DESC`,
        [`%|${playerKey}`],
      );
    },
    catch: (cause) => new PersistenceError({ operation: "list", cause }),
  }).pipe(
    Effect.flatMap((result) =>
      // Decode each row · skip rows that fail decode (logged as drift).
      // We do NOT fail the whole list on a single bad row — defensive.
      Effect.all(
        result.rows.map((row) =>
          Schema.decodeUnknown(QuestStateSchema)(row.state_json).pipe(
            Effect.option,
          ),
        ),
      ).pipe(
        Effect.map((opts) =>
          opts.flatMap((o) => (o._tag === "Some" ? [o.value] : [])),
        ),
      ),
    ),
    Effect.mapError((cause) =>
      cause instanceof PersistenceError
        ? cause
        : new PersistenceError({ operation: "list", cause }),
    ),
  );

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

const deleteEffect = (
  pool: QuestStatePostgresPool,
  tableName: string,
  quest_id: QuestId,
  player: PlayerIdentity,
): Effect.Effect<void, PersistenceError> =>
  Effect.tryPromise({
    try: async () => {
      await pool.query(
        `DELETE FROM ${tableName}
         WHERE quest_id = $1 AND player_key = $2`,
        [quest_id, composeKey(quest_id, player)],
      );
    },
    catch: (cause) => new PersistenceError({ operation: "delete", cause }),
  });
