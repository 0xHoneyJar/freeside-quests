import { Schema } from "effect";

/**
 * EventId — SHA-256 hex digest of an event's canonical preimage.
 *
 * Pattern: `^[a-f0-9]{64}$` — exactly 64 lowercase hex chars (per SDD §5.2 + §5.6).
 *
 * Constructor discipline: derived deterministically via {@link computeEventId}.
 * No bare `hash()` calls in adapters (architectural lock A6).
 */
export const EventId = Schema.String.pipe(
  Schema.pattern(/^[a-f0-9]{64}$/),
  Schema.brand("EventId"),
);

export type EventId = Schema.Schema.Type<typeof EventId>;
