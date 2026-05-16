import { Schema } from "effect";

import { ActivityReward } from "../activity/ActivityReward.js";
import { EventId } from "../branded/EventId.js";
import { IdentityId } from "../branded/IdentityId.js";
import { eventEnvelopeFields } from "./EventEnvelope.js";

/**
 * RewardFailedEvent — emitted on reward delivery failure (CL-Reward-2).
 *
 * `retryable=true` permits the engine to transition RewardState back to
 * Pending (FR-4.2). `retryable=false` is terminal — the substrate gives up
 * and the world is responsible for any manual intervention.
 */
export const RewardFailedEvent = Schema.Struct({
  ...eventEnvelopeFields,
  $id: Schema.Literal("https://schemas.freeside.thj/reward-failed/v1.0.0"),
  preimage_schema_id: Schema.Literal("https://schemas.freeside.thj/preimage/reward-failed/v1.0.0"),
  originating_event_id: EventId,
  recipient: IdentityId,
  reward_intent: ActivityReward,
  failure_reason: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512)),
  retryable: Schema.Boolean,
});

export type RewardFailedEvent = Schema.Schema.Type<typeof RewardFailedEvent>;
