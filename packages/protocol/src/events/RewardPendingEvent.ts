import { Schema } from "effect";

import { ActivityReward } from "../activity/ActivityReward.js";
import { EventId } from "../branded/EventId.js";
import { IdentityId } from "../branded/IdentityId.js";
import { eventEnvelopeFields } from "./EventEnvelope.js";

/**
 * RewardPendingEvent — wire envelope around `RewardState.RewardPending`
 * (CL-Reward-2 · per FR-5 + FR-4.1).
 *
 * Named with the `Event` suffix to disambiguate from the RewardState's
 * `RewardPending` TaggedStruct (which is the in-memory state-machine
 * representation, not the wire event).
 */
export const RewardPendingEvent = Schema.Struct({
  ...eventEnvelopeFields,
  $id: Schema.Literal("https://schemas.freeside.thj/reward-pending/v1.0.0"),
  preimage_schema_id: Schema.Literal("https://schemas.freeside.thj/preimage/reward-pending/v1.0.0"),
  originating_event_id: EventId,
  recipient: IdentityId,
  reward_intent: ActivityReward,
  attempts: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export type RewardPendingEvent = Schema.Schema.Type<typeof RewardPendingEvent>;
