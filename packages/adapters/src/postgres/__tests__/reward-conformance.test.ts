/**
 * Postgres RewardPort conformance — stub.
 *
 * Activates when `makePostgresRewardPort` lands. Until then the test
 * `describe` block is skipped.
 *
 * Reference: sprint-plan §12.3 Fix-S5 (T2.4b · postgres-adapter-conformance
 * test stub added).
 */
import { describe, it } from "vitest";

describe.skip("RewardPort conformance — postgres adapter", () => {
  it("PENDING: implement makePostgresRewardPort + wire to runRewardPortConformanceSuite", () => {
    // import { runRewardPortConformanceSuite } from "../../conformance/reward-port-conformance.js";
    // import { makePostgresRewardPort } from "../reward.js";
    // runRewardPortConformanceSuite(
    //   (config) => ({ port: makePostgresRewardPort({ pool: testPool, ...config }).port }),
    //   "postgres adapter",
    // );
  });
});
