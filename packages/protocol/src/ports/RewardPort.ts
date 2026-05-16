import type { Effect } from "effect";
import { Schema } from "effect";

import { ActivityReward, type RewardGranted } from "../activity/ActivityReward.js";
import { EventId } from "../branded/EventId.js";
import { IdentityId } from "../branded/IdentityId.js";

type RewardGrantedRecord = Schema.Schema.Type<typeof RewardGranted>;

/**
 * RewardError — sealed TaggedStruct union of failure modes for RewardPort
 * operations (FR-8 · CL-Port-2 + D18 idempotency · per PRD §FR-8).
 *
 * Variants:
 *   - AlreadyGranted        → idempotency hit · returns existing grant ref (D18)
 *   - GrantFailed           → delivery failed · retryable boolean is the FR-4.2 hint
 *   - IdentityUnresolvable  → identity exists in substrate but no chain address
 *   - AdapterUnavailable    → upstream reward adapter unreachable
 */
export const RewardAlreadyGranted = Schema.TaggedStruct("AlreadyGranted", {
  originating_event_id: EventId,
  existing_grant_id: EventId,
});

export const RewardGrantFailed = Schema.TaggedStruct("GrantFailed", {
  reward_intent: ActivityReward,
  reason: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512)),
  retryable: Schema.Boolean,
});

export const RewardIdentityUnresolvable = Schema.TaggedStruct("IdentityUnresolvable", {
  identity_id: IdentityId,
});

export const RewardAdapterUnavailable = Schema.TaggedStruct("AdapterUnavailable", {
  adapter_id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  reason: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512)),
});

export const RewardError = Schema.Union(
  RewardAlreadyGranted,
  RewardGrantFailed,
  RewardIdentityUnresolvable,
  RewardAdapterUnavailable,
);

export type RewardError = Schema.Schema.Type<typeof RewardError>;

/**
 * RewardPort — async reward delivery + idempotent grant lookup (FR-8 + D18).
 *
 * Per D18 idempotency contract (CL-Reward-2 · enforced by
 * reward-idempotency.test.ts in adapter conformance):
 *   1. Adapter checks for existing RewardGranted with matching
 *      (originating_event_id, recipient) tuple.
 *   2. If found → returns existing grant (NOT emit new).
 *   3. Else → grants + emits RewardGranted + returns.
 */
export interface RewardPort {
  readonly grant: (
    reward: ActivityReward,
    recipient: IdentityId,
    originatingEventId: EventId,
  ) => Effect.Effect<RewardGrantedRecord, RewardError>;
  readonly query: (
    identity: IdentityId,
  ) => Effect.Effect<ReadonlyArray<RewardGrantedRecord>, RewardError>;
}
