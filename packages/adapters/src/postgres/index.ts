/**
 * Postgres adapter family for @0xhoneyjar/quests-protocol ports (Seam-B · T-A1).
 *
 * Production backing for the typed ports. Consumers bring their own `pg.Pool`
 * (this package keeps `pg` as a test-only dev dependency — see ./pool.ts for
 * the structural interface a real Pool satisfies).
 *
 * Migration: db/migrations/2026-05-30-add-event-store.sql.
 */

export { makePostgresEventStore } from "./event-store.js";
export type {
  PostgresEventStoreConfig,
  PostgresEventStoreHandle,
} from "./event-store.js";

export { makePostgresRewardPort } from "./reward.js";
export type {
  PostgresRewardPortConfig,
  PostgresRewardPortHandle,
} from "./reward.js";

export { makePostgresProgressPort } from "./progress.js";
export type {
  PostgresProgressPortConfig,
  PostgresProgressPortHandle,
} from "./progress.js";

export { makePostgresIdentityResolver } from "./identity-resolver.js";
export type {
  IdentityBindingInput,
  PostgresIdentityResolverConfig,
  PostgresIdentityResolverHandle,
} from "./identity-resolver.js";

export type {
  EventStorePostgresClient,
  EventStorePostgresPool,
  PgQueryResult,
  QueryResultRow,
} from "./pool.js";
