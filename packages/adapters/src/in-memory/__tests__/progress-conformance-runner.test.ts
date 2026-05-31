/**
 * In-memory ProgressPort conformance (defect #21.3 · reference adapter).
 *
 * Wires the shared `runProgressPortConformanceSuite` to the Map-backed
 * in-memory adapter. The in-memory adapter is the single-threaded REFERENCE: if
 * the suite passes here AND against postgres, both adapters honor the same
 * black-box contract (CL-Progress-1 optimistic-CAS + CL-Port-2 reachability).
 */
import { runProgressPortConformanceSuite } from "../../conformance/progress-port-conformance.js";
import { makeInMemoryProgressPort } from "../progress.js";

runProgressPortConformanceSuite((config = {}) => {
  const handle = makeInMemoryProgressPort({
    knownActivities: config.knownActivities,
    knownIdentities: config.knownIdentities,
    simulatedFailures: config.simulatedFailures,
  });
  return { port: handle.port, clear: handle.clear };
}, "in-memory adapter");
