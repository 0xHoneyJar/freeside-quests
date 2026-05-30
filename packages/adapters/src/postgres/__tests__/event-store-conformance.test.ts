/**
 * Postgres EventStoreContract conformance (T-A1 · Lane A · UNMODIFIED suite).
 *
 * Wires the canonical `runEventStoreConformanceSuite` to the postgres adapter
 * via a disposable real-Postgres harness (see ./test-pg.ts for why real PG and
 * not pg-mem). The suite runs UNMODIFIED — if a scenario fails, the bug is in
 * the adapter, not the suite (postgres README "How to land" step 3).
 *
 * Each `factory()` call gets its own Postgres schema → independent store, as
 * the conformance factory contract requires.
 */
import { afterAll, beforeAll, describe, it } from "vitest";

import { runEventStoreConformanceSuite } from "../../conformance/event-store-conformance.js";
import { makePostgresEventStore } from "../event-store.js";
import type { EventStorePostgresPool } from "../pool.js";
import { startTestPostgres, type TestPostgres } from "./test-pg.js";

let harness: TestPostgres | null = null;

beforeAll(async () => {
  harness = await startTestPostgres();
}, 120_000);

afterAll(async () => {
  if (harness !== null) await harness.stop();
});

// If Docker is unavailable, startTestPostgres returns null; mark the suite
// skipped (rather than failing) so the gap is VISIBLE in CI output.
if (process.env.LOA_PG_CONFORMANCE_SKIP === "1") {
  describe.skip("EventStoreContract conformance — postgres adapter (skipped: LOA_PG_CONFORMANCE_SKIP)", () => {
    it("skipped", () => {});
  });
} else {
  runEventStoreConformanceSuite((config = {}) => {
    if (harness === null) {
      throw new Error(
        "test-postgres harness unavailable (Docker not running). " +
          "Set LOA_PG_CONFORMANCE_SKIP=1 to skip these tests.",
      );
    }
    const pool: EventStorePostgresPool = harness.freshPool();
    const handle = makePostgresEventStore({
      pool,
      expectedScope: config.expectedScope,
      verifyEventId: config.verifyEventId,
    });
    return { contract: handle.contract, port: handle.port };
  }, "postgres adapter");
}
