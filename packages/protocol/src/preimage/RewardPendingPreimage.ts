import { Schema } from "effect";

import { ActivityReward } from "../activity/ActivityReward.js";
import { EventId } from "../branded/EventId.js";
import { IdentityId } from "../branded/IdentityId.js";
import { preimageEnvelopeFields } from "./PreimageEnvelope.js";

/**
 * RewardPendingPreimage — canonical preimage shape for RewardPendingEvent
 * (§5.6 · T1.8 · per FR-5 + FR-4.1 + CL-Reward-2).
 *
 * Identical to {@link RewardPendingEvent} MINUS the `event_id` field.
 */
export const RewardPendingPreimage = Schema.Struct({
  ...preimageEnvelopeFields,
  $id: Schema.Literal("https://schemas.freeside.thj/reward-pending/v1.0.0"),
  preimage_schema_id: Schema.Literal("https://schemas.freeside.thj/preimage/reward-pending/v1.0.0"),
  originating_event_id: EventId,
  recipient: IdentityId,
  reward_intent: ActivityReward,
  attempts: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export type RewardPendingPreimage = Schema.Schema.Type<typeof RewardPendingPreimage>;
