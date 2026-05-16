import type { Effect } from "effect";
import { Schema } from "effect";

import { ActivityId } from "../branded/ActivityId.js";
import { EventId } from "../branded/EventId.js";
import { IdentityId } from "../branded/IdentityId.js";
import type { ActivityCompleted } from "../events/ActivityCompleted.js";
import type { EventError } from "../events/EventError.js";

/**
 * EventFilter — query shape for CompletionEventPort.query (FR-8 · per
 * PRD §FR-8 + cubquests user_activity_progress query pattern).
 *
 * All fields optional. Adapters resolve filters server-side; passing
 * none returns all events the caller is authorized to see.
 */
export const EventFilter = Schema.Struct({
  activity_id: Schema.optional(ActivityId),
  identity_id: Schema.optional(IdentityId),
  source_event_hash: Schema.optional(Schema.NullOr(EventId)),
  ts_after: Schema.optional(
    Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/)),
  ),
  ts_before: Schema.optional(
    Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/)),
  ),
  limit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 1000))),
});

export type EventFilter = Schema.Schema.Type<typeof EventFilter>;

/**
 * CompletionEventPort — the agent-facing event ingress/query port (FR-8).
 *
 * Adapters implementing this port also implement the {@link EventStoreContract}
 * (FR-11 · §4.2 · append-only · CAS · monotonic-sequence · duplicate-reject).
 * Port-level errors derive from the same EventError sealed union the
 * protocol publishes — adapters MUST cover every variant.
 */
export interface CompletionEventPort {
  readonly emit: (event: ActivityCompleted) => Effect.Effect<EventId, EventError>;
  readonly query: (
    filter: EventFilter,
  ) => Effect.Effect<ReadonlyArray<ActivityCompleted>, EventError>;
}
