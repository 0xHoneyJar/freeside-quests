import { Schema } from "effect";

/**
 * ActivityReward — minimal scaffold (T1.3 dependency stub).
 *
 * **Status**: PLACEHOLDER. The full sealed-union schema lands in T1.6 (FR-4)
 * and adds Token / NFT / Badge / Raffle / Composite variants plus the
 * RewardState async machine (Pending/Granted/Failed) per Fix-A1.
 *
 * The current stub exposes one variant — `None` — so the Activity schema
 * compiles and the FR-1 lifecycle exit path "Activity with no reward"
 * remains testable. Effect 3.x uses Schema.Union over Schema.TaggedStruct
 * (TaggedEnum was removed pre-3.x); T1.6 extends additively.
 */
export const ActivityRewardNone = Schema.TaggedStruct("None", {});

export const ActivityReward = Schema.Union(ActivityRewardNone);

export type ActivityReward = Schema.Schema.Type<typeof ActivityReward>;
