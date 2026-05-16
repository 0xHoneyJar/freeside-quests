/**
 * @0xhoneyjar/freeside-activities-adapters — adapter family for
 * @0xhoneyjar/quests-protocol ports.
 *
 * This entry re-exports the in-memory adapter family. Production adapters
 * (postgres · convex · etc) live in the consuming world per the
 * freeside-modules-as-installables doctrine — only the in-memory pack is
 * shipped here as a dev / test fixture.
 */

export * from "./in-memory/index.js";
