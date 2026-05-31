/**
 * Postgres IdentityResolver adapter — Seam-B backing (T-A1 · Lane A).
 *
 * Mirrors `../in-memory/identity-resolver.ts`. The forward/reverse Maps become
 * the `identity_bindings` table: PK (identity_id, chain) gives forward
 * resolution; UNIQUE (chain, address) guarantees CL-Identity-4 reverse
 * consistency at the DB layer (an address binds to at most one identity per
 * chain — a conflicting bind raises 23505 instead of silently overwriting).
 *
 * NOTE: like the in-memory stub, this is primarily a TEST/DEV fixture. Real
 * production identity binds to Dynamic / Privy / a custom resolver (A5). It is
 * shipped here so the postgres conformance harness and golden-replay tests can
 * exercise a durable resolver. `bind()` / `clear()` are sync-fire helpers that
 * enqueue best-effort writes for test seeding.
 */

import { Effect } from "effect";

import {
  type ChainAddress,
  IdentityChainNotSupported,
  type IdentityId,
  type IdentityResolverError,
  type IdentityResolverPort,
  IdentityResolverUnavailable,
  IdentityUnresolvableIdentity,
} from "@0xhoneyjar/quests-protocol";

import {
  type EventStorePostgresPool,
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
  type QueryResultRow,
} from "./pool.js";

export interface IdentityBindingInput {
  readonly identity_id: IdentityId;
  readonly chain: string;
  readonly address: ChainAddress;
}

export interface PostgresIdentityResolverConfig {
  readonly pool: EventStorePostgresPool;
  /** Chains the resolver supports. Calls for a chain outside this set fail with ChainNotSupported. */
  readonly supportedChains?: ReadonlySet<string>;
  readonly resolverId?: string;
  readonly simulatedFailures?: ReadonlyArray<{
    readonly on: "resolveToChainAddress" | "resolveFromChainAddress" | "any";
    readonly reason: string;
  }>;
  readonly tableName?: string;
}

export interface PostgresIdentityResolverHandle {
  readonly port: IdentityResolverPort;
  /**
   * Bind an (identity, chain) → address. Returns an Effect so callers compose
   * within the Effect runtime; rejects with ResolverUnavailable on a
   * conflicting reverse mapping (address already bound to a different identity).
   */
  readonly bind: (b: IdentityBindingInput) => Effect.Effect<void, IdentityResolverError>;
}

interface ForwardRow extends QueryResultRow {
  readonly address: string;
}
interface ReverseRow extends QueryResultRow {
  readonly identity_id: string;
}

export const makePostgresIdentityResolver = (
  config: PostgresIdentityResolverConfig,
): PostgresIdentityResolverHandle => {
  const { pool } = config;
  const table = config.tableName ?? "identity_bindings";
  const resolverId = config.resolverId ?? "postgres:identity-resolver";

  const pendingFailures = [...(config.simulatedFailures ?? [])];
  const consumeSimulatedFailure = (
    op: "resolveToChainAddress" | "resolveFromChainAddress",
  ): string | null => {
    const idx = pendingFailures.findIndex((f) => f.on === op || f.on === "any");
    if (idx === -1) return null;
    const failure = pendingFailures[idx]!;
    pendingFailures.splice(idx, 1);
    return failure.reason;
  };

  const chainSupported = (chain: string): boolean =>
    config.supportedChains === undefined || config.supportedChains.has(chain);

  const port: IdentityResolverPort = {
    resolveToChainAddress: (identity: IdentityId, chain: string) =>
      Effect.gen(function* () {
        const failureReason = consumeSimulatedFailure("resolveToChainAddress");
        if (failureReason !== null) {
          return yield* Effect.fail(
            IdentityResolverUnavailable.make({ resolver_id: resolverId, reason: failureReason }),
          );
        }
        if (!chainSupported(chain)) {
          return yield* Effect.fail(IdentityChainNotSupported.make({ chain }));
        }
        const res = yield* Effect.promise(() =>
          pool.query<ForwardRow>(
            `SELECT address FROM ${table} WHERE identity_id = $1 AND chain = $2 LIMIT 1`,
            [identity as unknown as string, chain],
          ),
        );
        const row = res.rows[0];
        if (row === undefined) {
          return yield* Effect.fail(
            IdentityUnresolvableIdentity.make({ identity_id: identity }),
          );
        }
        return row.address as unknown as ChainAddress;
      }) as Effect.Effect<ChainAddress, IdentityResolverError>,

    resolveFromChainAddress: (address: ChainAddress, chain: string) =>
      Effect.gen(function* () {
        const failureReason = consumeSimulatedFailure("resolveFromChainAddress");
        if (failureReason !== null) {
          return yield* Effect.fail(
            IdentityResolverUnavailable.make({ resolver_id: resolverId, reason: failureReason }),
          );
        }
        if (!chainSupported(chain)) {
          return yield* Effect.fail(IdentityChainNotSupported.make({ chain }));
        }
        const res = yield* Effect.promise(() =>
          pool.query<ReverseRow>(
            `SELECT identity_id FROM ${table} WHERE chain = $1 AND address = $2 LIMIT 1`,
            [chain, address as unknown as string],
          ),
        );
        const row = res.rows[0];
        if (row === undefined) {
          // No separate "AddressNotFound" variant in the sealed union (FR-12).
          return yield* Effect.fail(
            IdentityUnresolvableIdentity.make({
              identity_id: address as unknown as IdentityId,
            }),
          );
        }
        return row.identity_id as unknown as IdentityId;
      }) as Effect.Effect<IdentityId, IdentityResolverError>,
  };

  const bind = (b: IdentityBindingInput): Effect.Effect<void, IdentityResolverError> =>
    Effect.gen(function* () {
      const outcome = yield* Effect.promise(() =>
        pool
          .query(
            `INSERT INTO ${table} (identity_id, chain, address)
             VALUES ($1, $2, $3)
             ON CONFLICT (identity_id, chain) DO UPDATE SET address = EXCLUDED.address`,
            [b.identity_id as unknown as string, b.chain, b.address as unknown as string],
          )
          .then(() => ({ ok: true as const }))
          .catch((e: unknown) => ({ ok: false as const, error: e })),
      );
      if (!outcome.ok) {
        // UNIQUE (chain, address) violation ⇒ this address already binds to a
        // DIFFERENT identity on this chain — a CL-Identity-4 conflict.
        const reason =
          pgErrorCode(outcome.error) === PG_UNIQUE_VIOLATION
            ? `bind conflict: chain="${b.chain}" address already mapped to another identity`
            : `postgres bind failed: ${String(
                outcome.error instanceof Error ? outcome.error.message : outcome.error,
              )}`;
        return yield* Effect.fail(
          IdentityResolverUnavailable.make({
            resolver_id: resolverId,
            reason: reason.slice(0, 512),
          }),
        );
      }
    });

  return { port, bind };
};
