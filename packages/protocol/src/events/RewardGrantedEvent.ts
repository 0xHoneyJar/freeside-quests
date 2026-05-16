import { Schema } from "effect";

import { ActivityReward } from "../activity/ActivityReward.js";
import { EventId } from "../branded/EventId.js";
import { IdentityId } from "../branded/IdentityId.js";
import { eventEnvelopeFields } from "./EventEnvelope.js";

/**
 * RewardGrantedEvent — emitted on confirmed reward delivery (CL-Reward-2).
 *
 * Closes the chain: originating_event_id → granted_event_id (this event's
 * own event_id). Adapters MUST be idempotent on (originating_event_id,
 * recipient) — see D18 reward idempotency contract.
 */
export const RewardGrantedEvent = Schema.Struct({
  ...eventEnvelopeFields,
  $id: Schema.Literal("https://schemas.freeside.thj/reward-granted/v1.0.0"),
  preimage_schema_id: Schema.Literal("https://schemas.freeside.thj/preimage/reward-granted/v1.0.0"),
  originating_event_id: EventId,
  recipient: IdentityId,
  reward: ActivityReward,
});

export type RewardGrantedEvent = Schema.Schema.Type<typeof RewardGrantedEvent>;
