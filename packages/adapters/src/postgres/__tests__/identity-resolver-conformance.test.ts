/**
 * Postgres IdentityResolverPort conformance (defect #21.3 · real-PG harness).
 *
 * BEFORE this file, `makePostgresIdentityResolver` ran ZERO test lines. This
 * wires the shared `runIdentityResolverConformanceSuite` to the postgres
 * resolver via the disposable real-Postgres harness. The reverse-uniqueness
 * scenario (CL-Identity-4) is the load-bearing assertion: a conflicting bind
 * trips UNIQUE(chain,address) → 23505 → a sealed IdentityResolverError, which
 * the factory's `bindConflicts` reports as conflict=true.
 */
import { Effect } from "effect";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  runIdentityResolverConformanceSuite,
  type IdentityBindingForConformance,
} from "../../conformance/identity-resolver-conformance.js";
import { makePostgresIdentityResolver } from "../identity-resolver.js";
import type { EventStorePostgresPool } from "../pool.js";
import { startTestPostgres, type TestPostgres } from "./test-pg.js";

let harness: TestPostgres | null = null;

beforeAll(async () => {
  harness = await startTestPostgres();
}, 120_000);

afterAll(async () => {
  if (harness !== null) await harness.stop();
});

if (process.env.LOA_PG_CONFORMANCE_SKIP === "1") {
  describe.skip("IdentityResolverPort conformance — postgres adapter (skipped: LOA_PG_CONFORMANCE_SKIP)", () => {
    it("skipped", () => {});
  });
} else {
  runIdentityResolverConformanceSuite((config = {}) => {
    if (harness === null) {
      throw new Error(
        "test-postgres harness unavailable (Docker not running). " +
          "Set LOA_PG_CONFORMANCE_SKIP=1 to skip these tests.",
      );
    }
    const pool: EventStorePostgresPool = harness.freshPool();
    const handle = makePostgresIdentityResolver({
      pool,
      supportedChains: config.supportedChains,
      simulatedFailures: config.simulatedFailures,
    });
    return {
      port: handle.port,
      bind: async (b: IdentityBindingForConformance) => {
        await Effect.runPromise(
          handle.bind({
            identity_id: b.identity_id,
            chain: b.chain,
            address: b.address,
          }),
        );
      },
      bindConflicts: async (b: IdentityBindingForConformance) => {
        const outcome = await Effect.runPromise(
          Effect.either(
            handle.bind({
              identity_id: b.identity_id,
              chain: b.chain,
              address: b.address,
            }),
          ),
        );
        // _tag === "Left" ⇒ the bind FAILED with a sealed IdentityResolverError
        // (the 23505 → ResolverUnavailable conflict path). conflict === true.
        return { conflict: outcome._tag === "Left" };
      },
    };
  }, "postgres adapter");
}
