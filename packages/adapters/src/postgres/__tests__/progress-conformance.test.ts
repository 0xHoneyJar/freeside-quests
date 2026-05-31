/**
 * Postgres ProgressPort conformance (defect #21.3 · real-PG harness).
 *
 * BEFORE this file, `makePostgresProgressPort` ran ZERO test lines — a
 * reward-granting adapter shipped with no conformance gate. This wires the
 * shared `runProgressPortConformanceSuite` to the postgres adapter via the same
 * disposable real-Postgres harness as the event-store conformance test. Each
 * factory() call gets its own schema → independent store.
 *
 * The optimistic-CAS invariant (CL-Progress-1) runs here SERIALLY; the genuine
 * concurrency proof (defect #21.1 first-advance lost-update) lives in
 * progress-concurrency.test.ts.
 */
import { afterAll, beforeAll, describe, it } from "vitest";

import { runProgressPortConformanceSuite } from "../../conformance/progress-port-conformance.js";
import type { EventStorePostgresPool } from "../pool.js";
import { makePostgresProgressPort } from "../progress.js";
import { startTestPostgres, type TestPostgres } from "./test-pg.js";

let harness: TestPostgres | null = null;

beforeAll(async () => {
  harness = await startTestPostgres();
}, 120_000);

afterAll(async () => {
  if (harness !== null) await harness.stop();
});

if (process.env.LOA_PG_CONFORMANCE_SKIP === "1") {
  describe.skip("ProgressPort conformance — postgres adapter (skipped: LOA_PG_CONFORMANCE_SKIP)", () => {
    it("skipped", () => {});
  });
} else {
  runProgressPortConformanceSuite((config = {}) => {
    if (harness === null) {
      throw new Error(
        "test-postgres harness unavailable (Docker not running). " +
          "Set LOA_PG_CONFORMANCE_SKIP=1 to skip these tests.",
      );
    }
    const pool: EventStorePostgresPool = harness.freshPool();
    const handle = makePostgresProgressPort({
      pool,
      knownActivities: config.knownActivities,
      knownIdentities: config.knownIdentities,
      simulatedFailures: config.simulatedFailures,
    });
    return { port: handle.port };
  }, "postgres adapter");
}
