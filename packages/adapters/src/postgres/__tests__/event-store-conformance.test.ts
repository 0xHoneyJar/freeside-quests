/**
 * Postgres EventStoreContract conformance — stub.
 *
 * Activates when `makePostgresEventStore` lands. Until then the test
 * `describe` block is skipped; the file exists so the test runner reports
 * it as PENDING (not missing) and so CI tracks the gap.
 *
 * Reference: sprint-plan §12.3 Fix-S5 + §12.4 IMP-003 NEW S3.T3.10b.
 */
import { describe, it } from "vitest";

describe.skip("EventStoreContract conformance — postgres adapter", () => {
  it("PENDING: implement makePostgresEventStore + wire to runEventStoreConformanceSuite", () => {
    // import { runEventStoreConformanceSuite } from "../../conformance/event-store-conformance.js";
    // import { makePostgresEventStore } from "../event-store.js";
    // runEventStoreConformanceSuite(
    //   (config) => {
    //     const handle = makePostgresEventStore({ pool: testPool, ...config });
    //     return { contract: handle.contract, port: handle.port, clear: handle.clear };
    //   },
    //   "postgres adapter",
    // );
  });
});
