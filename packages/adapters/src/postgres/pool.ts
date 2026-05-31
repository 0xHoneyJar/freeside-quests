/**
 * Minimal Postgres pool/client interface for the Seam-B adapters
 * (T-A1 · cubquests-activities-extraction · Lane A).
 *
 * Mirrors the `QuestStatePostgresPool` abstraction in
 * `packages/engine/src/persistence/adapters/postgres.ts`: the consumer brings
 * their own `pg.Pool`; this package never imports `pg` at runtime (it's a
 * test-only dev dependency used by the conformance harness). The shape here is
 * a structural subset of node-pg's `Pool` / `PoolClient`, so a real
 * `new Pool(...)` satisfies it without a wrapper.
 *
 * Why this extends the engine's interface with `connect()`:
 *   The event-store's CAS (CL-EventStore-3) MUST run inside a multi-statement
 *   transaction at SERIALIZABLE isolation (SELECT-tip → INSERT) so two racing
 *   writers serialize. `pool.query` alone borrows a fresh connection per call
 *   and cannot hold a transaction across statements — we need a dedicated
 *   client checked out via `connect()`, BEGIN/COMMIT'd, then `release()`d.
 */

/** A row shape — kept loose so consumers can return whatever pg yields. */
export type QueryResultRow = Record<string, unknown>;

export interface PgQueryResult<T extends QueryResultRow = QueryResultRow> {
  readonly rows: T[];
  readonly rowCount: number | null;
}

/**
 * A checked-out connection that can hold a transaction across statements.
 * Structural subset of node-pg's `PoolClient`.
 */
export interface EventStorePostgresClient {
  readonly query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: ReadonlyArray<unknown>,
  ) => Promise<PgQueryResult<T>>;
  /** Returns the connection to the pool. node-pg's signature is `release(err?)`. */
  readonly release: (err?: unknown) => void;
}

/**
 * Structural subset of node-pg's `Pool`. `query` for single-shot reads;
 * `connect` for transaction scopes.
 */
export interface EventStorePostgresPool {
  readonly query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: ReadonlyArray<unknown>,
  ) => Promise<PgQueryResult<T>>;
  readonly connect: () => Promise<EventStorePostgresClient>;
}

/**
 * Postgres serialization-failure SQLSTATE: a transaction was rolled back
 * because it could not be serialized (SERIALIZABLE conflict). Retryable.
 */
export const PG_SERIALIZATION_FAILURE = "40001";

/** Deadlock detected — also retryable under the same backoff loop. */
export const PG_DEADLOCK_DETECTED = "40P01";

/** Unique-violation SQLSTATE — duplicate PK / unique constraint. */
export const PG_UNIQUE_VIOLATION = "23505";

/** Extract a Postgres SQLSTATE `code` from an unknown thrown value, if present. */
export const pgErrorCode = (e: unknown): string | undefined => {
  if (typeof e === "object" && e !== null && "code" in e) {
    const code = (e as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
};

/** The constraint name attached to a unique-violation, if the driver supplies it. */
export const pgConstraint = (e: unknown): string | undefined => {
  if (typeof e === "object" && e !== null && "constraint" in e) {
    const c = (e as { constraint?: unknown }).constraint;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
};
