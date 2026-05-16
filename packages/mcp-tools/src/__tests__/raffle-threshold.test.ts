/**
 * T2.15 acceptance — TIER-1 raffle threshold (D25).
 *
 * Threshold: reward_count > 10 OR reward_class in {NFT, token}
 * TIER-1 REJECTS above threshold unless explicit opt-in.
 */
import { describe, expect, it } from "vitest";

import {
  classifyRaffleTier,
  HIGH_VALUE_REWARD_CLASSES,
  isAboveTier1Threshold,
  RaffleTierViolation,
  TIER_1_REWARD_COUNT_THRESHOLD,
  type RewardClass,
} from "../raffle-threshold.js";

describe("isAboveTier1Threshold predicate", () => {
  it("low-value low-count → false", () => {
    expect(isAboveTier1Threshold("narrative", 5)).toBe(false);
    expect(isAboveTier1Threshold("cosmetic", 10)).toBe(false);
    expect(isAboveTier1Threshold("external", 10)).toBe(false);
  });

  it("count > 10 → true regardless of class", () => {
    expect(isAboveTier1Threshold("narrative", 11)).toBe(true);
    expect(isAboveTier1Threshold("cosmetic", 100)).toBe(true);
  });

  it("NFT class → true regardless of count", () => {
    expect(isAboveTier1Threshold("NFT", 1)).toBe(true);
    expect(isAboveTier1Threshold("NFT", 100)).toBe(true);
  });

  it("token class → true regardless of count", () => {
    expect(isAboveTier1Threshold("token", 1)).toBe(true);
    expect(isAboveTier1Threshold("token", 5)).toBe(true);
  });

  it("constant threshold matches D25 resolution", () => {
    expect(TIER_1_REWARD_COUNT_THRESHOLD).toBe(10);
    expect(HIGH_VALUE_REWARD_CLASSES.has("NFT" as RewardClass)).toBe(true);
    expect(HIGH_VALUE_REWARD_CLASSES.has("token" as RewardClass)).toBe(true);
    expect(HIGH_VALUE_REWARD_CLASSES.has("cosmetic" as RewardClass)).toBe(false);
  });
});

describe("classifyRaffleTier — gate", () => {
  it("accepts TIER-1 below threshold", () => {
    const result = classifyRaffleTier({
      rewardClass: "narrative",
      rewardCount: 5,
      declaredTier: "TIER-1",
    });
    expect(result._tag).toBe("ok");
  });

  it("accepts TIER-2 above threshold (escalation path)", () => {
    const result = classifyRaffleTier({
      rewardClass: "NFT",
      rewardCount: 1,
      declaredTier: "TIER-2",
    });
    expect(result._tag).toBe("ok");
  });

  it("accepts TIER-3 above threshold", () => {
    const result = classifyRaffleTier({
      rewardClass: "token",
      rewardCount: 50,
      declaredTier: "TIER-3",
    });
    expect(result._tag).toBe("ok");
  });

  describe("CMP-CONVENTION acceptance cases (D25)", () => {
    it("11-prize raffle declared TIER-1 → REJECTED", () => {
      const result = classifyRaffleTier({
        rewardClass: "cosmetic",
        rewardCount: 11,
        declaredTier: "TIER-1",
      });
      expect(result).toBeInstanceOf(RaffleTierViolation);
      if (result instanceof RaffleTierViolation) {
        expect(result.required_tier_min).toBe("TIER-2");
      }
    });

    it("NFT prize raffle declared TIER-1 → REJECTED", () => {
      const result = classifyRaffleTier({
        rewardClass: "NFT",
        rewardCount: 1,
        declaredTier: "TIER-1",
      });
      expect(result).toBeInstanceOf(RaffleTierViolation);
    });

    it("11-prize NFT raffle declared TIER-2 → ACCEPTED", () => {
      const result = classifyRaffleTier({
        rewardClass: "NFT",
        rewardCount: 11,
        declaredTier: "TIER-2",
      });
      expect(result._tag).toBe("ok");
    });
  });

  describe("explicit opt-in override", () => {
    it("11-prize raffle with optInTier1AboveThreshold=true → ACCEPTED as TIER-1", () => {
      const result = classifyRaffleTier({
        rewardClass: "cosmetic",
        rewardCount: 11,
        declaredTier: "TIER-1",
        optInTier1AboveThreshold: true,
      });
      expect(result._tag).toBe("ok");
      if (result._tag === "ok") expect(result.tier).toBe("TIER-1");
    });

    it("NFT raffle with optInTier1AboveThreshold=true → ACCEPTED as TIER-1", () => {
      const result = classifyRaffleTier({
        rewardClass: "NFT",
        rewardCount: 1,
        declaredTier: "TIER-1",
        optInTier1AboveThreshold: true,
      });
      expect(result._tag).toBe("ok");
    });

    it("optInTier1AboveThreshold=false (explicit) → REJECTED", () => {
      const result = classifyRaffleTier({
        rewardClass: "NFT",
        rewardCount: 1,
        declaredTier: "TIER-1",
        optInTier1AboveThreshold: false,
      });
      expect(result).toBeInstanceOf(RaffleTierViolation);
    });
  });
});
