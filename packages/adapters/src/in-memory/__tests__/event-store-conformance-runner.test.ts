/**
 * Wires the canonical EventStoreContract conformance suite to the in-memory
 * adapter factory (sprint-2 review C3). The original detailed test file
 * stays at `event-store-conformance.test.ts` — this runner is the
 * factory-shaped entry point future adapters (postgres · convex) will
 * mirror with their own factories.
 */
import { runEventStoreConformanceSuite } from "../../conformance/event-store-conformance.js";
import { makeInMemoryEventStore } from "../completion-event.js";

runEventStoreConformanceSuite(
  (config = {}) => {
    const handle = makeInMemoryEventStore({
      expectedScope: config.expectedScope,
      verifyEventId: config.verifyEventId,
    });
    return { contract: handle.contract, port: handle.port, clear: handle.clear };
  },
  "in-memory adapter",
);
