/**
 * Disposable-Postgres test harness for the Seam-B conformance suites (T-A1).
 *
 * ── Why a REAL Postgres (Docker) and not pg-mem ──────────────────────────────
 *
 * The event-store CAS correctness (CL-EventStore-3) is the load-bearing claim
 * of this task, and the conformance suite proves it under concurrency. pg-mem
 * is single-threaded and does NOT implement SERIALIZABLE isolation, predicate
 * locking, or `SELECT … FOR UPDATE` blocking — so a concurrency test would pass
 * against pg-mem TRIVIALLY (no real contention) and prove nothing. We therefore
 * run against a real `postgres:16-alpine` container so the SERIALIZABLE
 * predicate lock + FOR UPDATE row lock are genuinely exercised.
 *
 * ── Isolation per factory() call ─────────────────────────────────────────────
 *
 * The conformance factory contract requires each `factory()` to return a fresh,
 * independent store. We give each call its own Postgres SCHEMA (a unique
 * `conf_<n>` namespace) and a pool whose every connection is pinned to that
 * schema via `search_path`. The schema + its tables are created lazily and
 * memoized on first query. One container + one connection pool back the whole
 * suite; only the schema differs per factory call → true isolation, cheap.
 *
 * The harness lifecycle (start container, end pool, stop container) is driven by
 * the test file's beforeAll/afterAll via {@link startTestPostgres}.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool, type PoolClient } from "pg";

import type {
  EventStorePostgresClient,
  EventStorePostgresPool,
  PgQueryResult,
  QueryResultRow,
} from "../pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// db/migrations/2026-05-30-add-event-store.sql relative to this file:
// packages/adapters/src/postgres/__tests__/ → repo root is five levels up.
const MIGRATION_PATH = resolve(
  __dirname,
  "../../../../../db/migrations/2026-05-30-add-event-store.sql",
);

const CONTAINER_NAME = `loa-lane-a-conf-${process.pid}`;
const PG_IMAGE = "postgres:16-alpine";
const PG_USER = "conf";
const PG_PASSWORD = "conf";
const PG_DB = "conformance";

const docker = (args: string[]): string =>
  execFileSync("docker", args, { encoding: "utf8" }).trim();

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export interface FreshPoolOptions {
  /**
   * Extra DDL applied to the fresh schema AFTER the event-store migration
   * (e.g. the apply_resource_mutation test fixture for the T-A2 atomicity
   * suite). Loaded into the SAME schema via search_path, memoized with the
   * migration so it runs exactly once per schema. Default: none.
   */
  readonly extraDdl?: ReadonlyArray<string>;
}

export interface TestPostgres {
  /** The raw pg.Pool — schema-agnostic (search_path = public). */
  readonly rawPool: Pool;
  /** Build a fresh schema-isolated pool wrapper (one per factory() call). */
  readonly freshPool: (options?: FreshPoolOptions) => EventStorePostgresPool;
  /** Tear down: end the pool + stop/remove the container. */
  readonly stop: () => Promise<void>;
}

let schemaCounter = 0;

/**
 * Starts a disposable Postgres container, waits for readiness, and returns a
 * harness. Skips (returns null) if Docker is unavailable so the suite can be
 * marked skipped rather than failing on machines without Docker.
 */
export const startTestPostgres = async (): Promise<TestPostgres | null> => {
  // Probe docker availability.
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
  } catch {
    return null;
  }

  // Start container with an ephemeral host port.
  docker([
    "run",
    "-d",
    "--rm",
    "--name",
    CONTAINER_NAME,
    "-e",
    `POSTGRES_USER=${PG_USER}`,
    "-e",
    `POSTGRES_PASSWORD=${PG_PASSWORD}`,
    "-e",
    `POSTGRES_DB=${PG_DB}`,
    "-P",
    PG_IMAGE,
  ]);

  const stopContainer = (): void => {
    try {
      docker(["stop", CONTAINER_NAME]);
    } catch {
      /* already gone */
    }
  };

  try {
    // Resolve mapped host port for 5432.
    const portLine = docker(["port", CONTAINER_NAME, "5432/tcp"]);
    const hostPort = Number.parseInt(portLine.split(":").pop() ?? "", 10);
    if (!Number.isInteger(hostPort)) {
      throw new Error(`could not parse mapped port from "${portLine}"`);
    }

    // Wait for pg_isready (up to ~30s).
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        execFileSync(
          "docker",
          ["exec", CONTAINER_NAME, "pg_isready", "-U", PG_USER, "-d", PG_DB],
          { stdio: "ignore" },
        );
        ready = true;
        break;
      } catch {
        await sleep(500);
      }
    }
    if (!ready) throw new Error("postgres container never became ready");

    const rawPool = new Pool({
      host: "127.0.0.1",
      port: hostPort,
      user: PG_USER,
      password: PG_PASSWORD,
      database: PG_DB,
      max: 16,
    });

    // A couple of connect attempts to ride out the tail of startup.
    let connected = false;
    for (let i = 0; i < 20; i++) {
      try {
        const c = await rawPool.connect();
        await c.query("SELECT 1");
        c.release();
        connected = true;
        break;
      } catch {
        await sleep(500);
      }
    }
    if (!connected) throw new Error("could not establish a pool connection");

    const migrationSql = readFileSync(MIGRATION_PATH, "utf8");

    // Memoize the DDL setup as a PROMISE per schema (not a boolean flag): N
    // concurrent first-touch queries on a fresh schema must all await the SAME
    // single CREATE SCHEMA + migration run. A boolean flag races — concurrent
    // CREATE SCHEMA / CREATE TABLE collide on Postgres catalog unique indexes
    // (pg_namespace, pg_type). This is what the concurrency test exposed.
    const ensuredSchemas = new Map<string, Promise<void>>();
    const ensureSchema = (
      schema: string,
      extraDdl: ReadonlyArray<string> = [],
    ): Promise<void> => {
      const existing = ensuredSchemas.get(schema);
      if (existing !== undefined) return existing;
      const setup = (async () => {
        const c = await rawPool.connect();
        try {
          await c.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
          // Apply the migration INSIDE the schema via search_path so the
          // CREATE TABLE statements land in `schema`, not `public`.
          await c.query(`SET search_path TO ${schema}`);
          await c.query(migrationSql);
          // Optional extra DDL (e.g. the apply_resource_mutation fixture) lands
          // in the SAME schema, after the migration.
          for (const ddl of extraDdl) {
            await c.query(ddl);
          }
        } finally {
          c.release();
        }
      })();
      ensuredSchemas.set(schema, setup);
      return setup;
    };

    /**
     * Wraps a checked-out client so its search_path is pinned to `schema`.
     */
    const wrapClient = (client: PoolClient): EventStorePostgresClient => ({
      query: <T extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: ReadonlyArray<unknown>,
      ): Promise<PgQueryResult<T>> =>
        client.query(text, values as unknown[] | undefined) as unknown as Promise<
          PgQueryResult<T>
        >,
      release: (err?: unknown) => client.release(err as Error | undefined),
    });

    const freshPool = (options?: FreshPoolOptions): EventStorePostgresPool => {
      schemaCounter += 1;
      const schema = `conf_${schemaCounter}`;
      const extraDdl = options?.extraDdl ?? [];
      return {
        query: async <T extends QueryResultRow = QueryResultRow>(
          text: string,
          values?: ReadonlyArray<unknown>,
        ): Promise<PgQueryResult<T>> => {
          await ensureSchema(schema, extraDdl);
          const c = await rawPool.connect();
          try {
            await c.query(`SET search_path TO ${schema}`);
            return (await c.query(
              text,
              values as unknown[] | undefined,
            )) as unknown as PgQueryResult<T>;
          } finally {
            c.release();
          }
        },
        connect: async (): Promise<EventStorePostgresClient> => {
          await ensureSchema(schema, extraDdl);
          const c = await rawPool.connect();
          await c.query(`SET search_path TO ${schema}`);
          return wrapClient(c);
        },
      };
    };

    return {
      rawPool,
      freshPool,
      stop: async () => {
        await rawPool.end().catch(() => undefined);
        stopContainer();
      },
    };
  } catch (e) {
    stopContainer();
    throw e;
  }
};
