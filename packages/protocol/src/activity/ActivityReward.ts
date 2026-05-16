import { Schema } from "effect";

import { CosmeticId } from "../branded/CosmeticId.js";
import { EventId } from "../branded/EventId.js";
import { MintIntentId } from "../branded/MintIntentId.js";
import { TokenId } from "../branded/TokenId.js";
import { RFC3339Date } from "../encoding/date.js";
import { DecimalValue } from "../encoding/decimal.js";

/**
 * ActivityReward — sealed union (FR-4 · CL-Reward-1..3 · per PRD §FR-4).
 *
 * Six variants covering the reward kinds worlds emit:
 *   - BadgeMint    → forward-compat to freeside-mint sibling (mint_intent_id)
 *   - TokenAmount  → fungible token { token_id, amount: DecimalValue }
 *   - Resource     → world-defined economy { resource_kind, amount }
 *   - Cosmetic     → cosmetic id reference
 *   - External     → off-chain reward { uri, claim_proof }
 *   - None         → completion is the reward (narrative-only)
 *
 * BigInt amounts are encoded as the canonical {@link DecimalValue} struct
 * (D14 RESOLVED · per SDD §5.3) — preserves arbitrary precision while
 * staying JCS-friendly.
 */
export const ActivityRewardBadgeMint = Schema.TaggedStruct("BadgeMint", {
  mint_intent_id: MintIntentId,
});

export const ActivityRewardTokenAmount = Schema.TaggedStruct("TokenAmount", {
  token_id: TokenId,
  amount: DecimalValue,
});

export const ActivityRewardResource = Schema.TaggedStruct("Resource", {
  resource_kind: Schema.String.pipe(Schema.pattern(/^[a-z][a-z0-9_-]{0,127}$/)),
  amount: Schema.Number.pipe(Schema.nonNegative()),
});

export const ActivityRewardCosmetic = Schema.TaggedStruct("Cosmetic", {
  cosmetic_id: CosmeticId,
});

export const ActivityRewardExternal = Schema.TaggedStruct("External", {
  reward_uri: Schema.String.pipe(
    Schema.pattern(/^https?:\/\/[^\s]+$/),
    Schema.minLength(1),
    Schema.maxLength(512),
  ),
  claim_proof: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1024)),
});

export const ActivityRewardNone = Schema.TaggedStruct("None", {});

export const ActivityReward = Schema.Union(
  ActivityRewardBadgeMint,
  ActivityRewardTokenAmount,
  ActivityRewardResource,
  ActivityRewardCosmetic,
  ActivityRewardExternal,
  ActivityRewardNone,
);

export type ActivityReward = Schema.Schema.Type<typeof ActivityReward>;

/**
 * RewardState — async reward state machine (FR-4.1 · per PRD §FR-4).
 *
 * Transitions (FR-4.2 · enforced by `packages/engine/retry.ts` in S2):
 *   - Pending → Granted       (success)
 *   - Pending → Failed (retryable=true)  → may transition back to Pending
 *   - Pending → Failed (retryable=false) → terminal
 *
 * CL-Reward-2: every reward emission emits Pending FIRST · only on confirmed
 * delivery transitions to Granted. CL-Reward-3: originating_event_id links
 * the chain back to ActivityCompleted (hash-chain-continuity).
 */
export const RewardPending = Schema.TaggedStruct("RewardPending", {
  reward_intent: ActivityReward,
  originating_event_id: EventId,
  attempts: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export const RewardGranted = Schema.TaggedStruct("RewardGranted", {
  reward: ActivityReward,
  originating_event_id: EventId,
  granted_event_id: EventId,
  ts: RFC3339Date,
});

export const RewardFailed = Schema.TaggedStruct("RewardFailed", {
  reward_intent: ActivityReward,
  originating_event_id: EventId,
  failure_reason: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512)),
  ts: RFC3339Date,
  retryable: Schema.Boolean,
});

export const RewardState = Schema.Union(RewardPending, RewardGranted, RewardFailed);

export type RewardState = Schema.Schema.Type<typeof RewardState>;
