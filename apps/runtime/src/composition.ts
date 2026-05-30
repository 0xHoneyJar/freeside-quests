/**
 * Composition root — wires the activities engine's Seam-B Postgres adapters
 * (T-A1) from environment, with NO hardcoded connection details.
 *
 * SDD §5: "Composition root: a `cubquest` world Layer providing Seam-B
 * Postgres adapters from `TENANT_CUBQUEST_DATABASE_URL`."
 *
 * The pool is OPTIONAL at boot. The runtime serves the READ plane; `/health`
 * and `/.well-known/beacon.json` must answer even before a DB binding lands
 * (so T-A5 can deploy + verify liveness/beacon ahead of provisioning
 * `cubquest-db`). Data routes return a `completeness: { status: "degraded" }`
 * envelope when no pool is configured — they NEVER crash the process (the
 * inventory-Flip degraded-envelope precedent, SDD §8 + §12.4).
 *
 * Read-only here: the runtime exposes ONLY the query side of each port
 * (getProgress / RewardPort.query / CompletionEventPort.query). Write routes
 * (completion / grant) land behind the G-4 parity gate + GATE-SEC-1 (SDD §13)
 * — they are intentionally NOT wired into this composition.
 */

import { Pool } from "pg";

import {
  makePostgresEventStore,
  makePostgresProgressPort,
  makePostgresRewardPort,
  type PostgresEventStoreHandle,
  type PostgresProgressPortHandle,
  type PostgresRewardPortHandle,
} from "@0xhoneyjar/freeside-activities-adapters/postgres";

/**
 * Resolve the Postgres connection string from the environment, in the
 * precedence the SDD names:
 *   1. TENANT_CUBQUEST_DATABASE_URL — the per-tenant cubquest-db binding
 *      (the per-world Layer convention, postgres.ts:37-45).
 *   2. DATABASE_URL — the generic fallback (Railway's default Postgres var).
 */
export const resolveDatabaseUrl = (
  env: Record<string, string | undefined> = process.env,
): string | undefined =>
  env.TENANT_CUBQUEST_DATABASE_URL ?? env.DATABASE_URL ?? undefined;

/** The composed read surface the runtime serves. `null` when no DB is wired. */
export interface ActivitiesReadSurface {
  readonly eventStore: PostgresEventStoreHandle;
  readonly progress: PostgresProgressPortHandle;
  readonly reward: PostgresRewardPortHandle;
}

export interface Composition {
  /**
   * The read surface, or `null` when no DATABASE_URL is configured. Data
   * routes branch on this: null → degraded envelope; present → live read.
   */
  readonly surface: ActivitiesReadSurface | null;
  /** The underlying pool (for graceful shutdown). `null` when degraded. */
  readonly pool: Pool | null;
  /** Which env var supplied the URL, for the degraded-envelope `reason`. */
  readonly source: "TENANT_CUBQUEST_DATABASE_URL" | "DATABASE_URL" | "none";
  /** Close the pool (idempotent). */
  readonly close: () => Promise<void>;
}

/**
 * buildComposition — read the env, and (if a DB URL is present) construct a
 * `pg.Pool` + the three Seam-B read adapters. `pg.Pool` satisfies the
 * adapters' structural `EventStorePostgresPool` interface (query + connect)
 * without a wrapper (pool.ts:45-51).
 *
 * `verifyEventId` is left at its adapter default (true) on the read path's
 * EventStore handle — read methods (getTip/read/query) never recompute, so
 * this is inert for reads; it matters only on the (unwired) write path.
 */
export const buildComposition = (
  env: Record<string, string | undefined> = process.env,
): Composition => {
  const url = resolveDatabaseUrl(env);
  const source: Composition["source"] =
    env.TENANT_CUBQUEST_DATABASE_URL !== undefined
      ? "TENANT_CUBQUEST_DATABASE_URL"
      : env.DATABASE_URL !== undefined
        ? "DATABASE_URL"
        : "none";

  if (url === undefined) {
    return {
      surface: null,
      pool: null,
      source: "none",
      close: async () => {},
    };
  }

  const pool = new Pool({ connectionString: url });

  // pg.Pool is a structural superset of EventStorePostgresPool; the cast is
  // the documented boundary (pool.ts header). We narrow to the read methods
  // the adapters expose.
  const poolLike = pool as unknown as Parameters<
    typeof makePostgresEventStore
  >[0]["pool"];

  const eventStore = makePostgresEventStore({ pool: poolLike });
  const progress = makePostgresProgressPort({ pool: poolLike });
  const reward = makePostgresRewardPort({ pool: poolLike });

  return {
    surface: { eventStore, progress, reward },
    pool,
    source,
    close: async () => {
      await pool.end();
    },
  };
};
