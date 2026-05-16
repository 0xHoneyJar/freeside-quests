/**
 * TIER-1 raffle threshold (T2.15 · D25 RESOLVED).
 *
 * TIER-1 raffles (PRNG-only · no externally-anchored randomness) are
 * acceptable ONLY for low-stakes raffles. The threshold for "low-stakes":
 *
 *   reward_count > 10 OR reward_class in {NFT, token}
 *
 * Above the threshold, TIER-1 REJECTS the raffle unless the cycle config
 * declares an explicit `opt_in_tier_1_above_threshold: true` flag.
 *
 * TIER-2 + TIER-3 use externally-anchored randomness (block hash · VRF) and
 * have no threshold. This module enforces the gate at substrate boundary;
 * the engine raffle drawing code consults `classifyRaffleTier` before
 * sampling.
 *
 * The actual TIER-2/TIER-3 implementations live in the engine retry +
 * raffle drawing modules (post-cycle). This file holds the THRESHOLD POLICY.
 */
import { Data } from "effect";

/**
 * Reward classes that carry on-chain value. Above-threshold raffles
 * involving these MUST escalate to TIER-2 or TIER-3.
 *
 * NOTE: this is the ENGAGEMENT-layer classification, distinct from the
 * protocol's ActivityReward sealed union. The mapping:
 *   - "narrative"  → ActivityRewardNone
 *   - "cosmetic"   → ActivityRewardCosmetic (off-chain)
 *   - "external"   → ActivityRewardExternal (off-chain)
 *   - "NFT"        → ActivityRewardBadgeMint (on-chain · ERC-721)
 *   - "token"      → ActivityRewardTokenAmount (on-chain · ERC-20)
 *   - "resource"   → ActivityRewardResource (world economy · classification
 *                    depends on world but treated as on-chain here)
 */
export type RewardClass = "narrative" | "cosmetic" | "external" | "NFT" | "token" | "resource";

export const HIGH_VALUE_REWARD_CLASSES: ReadonlySet<RewardClass> = new Set<RewardClass>([
  "NFT",
  "token",
]);

export type RaffleTier = "TIER-1" | "TIER-2" | "TIER-3";

export interface RaffleTierEval {
  readonly rewardClass: RewardClass;
  readonly rewardCount: number;
  readonly declaredTier: RaffleTier;
  readonly optInTier1AboveThreshold?: boolean;
}

export class RaffleTierViolation extends Data.TaggedError("RaffleTierViolation")<{
  readonly reason: string;
  readonly required_tier_min: "TIER-2";
}> {}

/**
 * threshold predicate (load-bearing constants are exported below for
 * test + doc reuse).
 */
export const TIER_1_REWARD_COUNT_THRESHOLD = 10 as const;

export const isAboveTier1Threshold = (
  rewardClass: RewardClass,
  rewardCount: number,
): boolean => {
  if (rewardCount > TIER_1_REWARD_COUNT_THRESHOLD) return true;
  if (HIGH_VALUE_REWARD_CLASSES.has(rewardClass)) return true;
  return false;
};

/**
 * classifyRaffleTier — gate evaluator. Returns ok if the declared tier
 * satisfies the threshold; fails with RaffleTierViolation otherwise.
 *
 * Used by:
 *   - cycle config validator (rejects misconfigured cycles at load time)
 *   - engine raffle drawing module (defense in depth — fails closed if
 *     a stale cycle config slips through)
 *   - CMP-CONVENTION documentation lint (cycle docs cite this surface)
 */
export const classifyRaffleTier = (
  evalInput: RaffleTierEval,
): { _tag: "ok"; tier: RaffleTier } | RaffleTierViolation => {
  const above = isAboveTier1Threshold(evalInput.rewardClass, evalInput.rewardCount);
  if (!above) {
    return { _tag: "ok", tier: evalInput.declaredTier };
  }
  if (evalInput.declaredTier === "TIER-2" || evalInput.declaredTier === "TIER-3") {
    return { _tag: "ok", tier: evalInput.declaredTier };
  }
  // declared TIER-1 + above threshold
  if (evalInput.optInTier1AboveThreshold === true) {
    return { _tag: "ok", tier: "TIER-1" };
  }
  return new RaffleTierViolation({
    reason: `TIER-1 raffles cannot be used above the threshold (reward_count > ${TIER_1_REWARD_COUNT_THRESHOLD} OR reward_class in {NFT, token}). Got reward_count=${evalInput.rewardCount}, reward_class=${evalInput.rewardClass}.`,
    required_tier_min: "TIER-2",
  });
};
