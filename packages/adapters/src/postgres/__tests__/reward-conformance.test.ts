/**
 * Postgres RewardPort conformance (T-A1 · Lane A · UNMODIFIED suite).
 *
 * Wires the canonical `runRewardPortConformanceSuite` to the postgres reward
 * adapter via the same disposable real-Postgres harness as the event-store
 * conformance test. Suite runs UNMODIFIED.
 */
import { afterAll, beforeAll, describe, it } from "vitest";

import { runRewardPortConformanceSuite } from "../../conformance/reward-port-conformance.js";
import type { EventStorePostgresPool } from "../pool.js";
import { makePostgresRewardPort } from "../reward.js";
import { startTestPostgres, type TestPostgres } from "./test-pg.js";

let harness: TestPostgres | null = null;

beforeAll(async () => {
  harness = await startTestPostgres();
}, 120_000);

afterAll(async () => {
  if (harness !== null) await harness.stop();
});

if (process.env.LOA_PG_CONFORMANCE_SKIP === "1") {
  describe.skip("RewardPort conformance — postgres adapter (skipped: LOA_PG_CONFORMANCE_SKIP)", () => {
    it("skipped", () => {});
  });
} else {
  runRewardPortConformanceSuite((config = {}) => {
    if (harness === null) {
      throw new Error(
        "test-postgres harness unavailable (Docker not running). " +
          "Set LOA_PG_CONFORMANCE_SKIP=1 to skip these tests.",
      );
    }
    const pool: EventStorePostgresPool = harness.freshPool();
    return {
      port: makePostgresRewardPort({
        pool,
        unresolvableIdentities: config.unresolvableIdentities,
        failingGrants: config.failingGrants,
        simulatedFailures: config.simulatedFailures,
      }).port,
    };
  }, "postgres adapter");
}
