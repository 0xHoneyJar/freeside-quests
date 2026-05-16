import { Schema } from "effect";

import { ActivityReward } from "../activity/ActivityReward.js";
import { EventId } from "../branded/EventId.js";
import { IdentityId } from "../branded/IdentityId.js";
import { preimageEnvelopeFields } from "./PreimageEnvelope.js";

/**
 * RewardFailedPreimage — canonical preimage shape for RewardFailedEvent
 * (§5.6 · T1.8 · per FR-5 + CL-Reward-2).
 *
 * Identical to {@link RewardFailedEvent} MINUS the `event_id` field.
 */
export const RewardFailedPreimage = Schema.Struct({
  ...preimageEnvelopeFields,
  $id: Schema.Literal("https://schemas.freeside.thj/reward-failed/v1.0.0"),
  preimage_schema_id: Schema.Literal("https://schemas.freeside.thj/preimage/reward-failed/v1.0.0"),
  originating_event_id: EventId,
  recipient: IdentityId,
  reward_intent: ActivityReward,
  failure_reason: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512)),
  retryable: Schema.Boolean,
});

export type RewardFailedPreimage = Schema.Schema.Type<typeof RewardFailedPreimage>;
