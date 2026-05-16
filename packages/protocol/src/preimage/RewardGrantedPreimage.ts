import { Schema } from "effect";

import { ActivityReward } from "../activity/ActivityReward.js";
import { EventId } from "../branded/EventId.js";
import { IdentityId } from "../branded/IdentityId.js";
import { preimageEnvelopeFields } from "./PreimageEnvelope.js";

/**
 * RewardGrantedPreimage — canonical preimage shape for RewardGrantedEvent
 * (§5.6 · T1.8 · per FR-5 + CL-Reward-2).
 *
 * Identical to {@link RewardGrantedEvent} MINUS the `event_id` field.
 */
export const RewardGrantedPreimage = Schema.Struct({
  ...preimageEnvelopeFields,
  $id: Schema.Literal("https://schemas.freeside.thj/reward-granted/v1.0.0"),
  preimage_schema_id: Schema.Literal("https://schemas.freeside.thj/preimage/reward-granted/v1.0.0"),
  originating_event_id: EventId,
  recipient: IdentityId,
  reward: ActivityReward,
});

export type RewardGrantedPreimage = Schema.Schema.Type<typeof RewardGrantedPreimage>;
