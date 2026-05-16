import { Schema } from "effect";

import { EventId } from "../branded/EventId.js";
import { RFC3339Date } from "../encoding/date.js";

/**
 * Common-shape fields every event carries (FR-5 · per PRD §FR-5).
 *
 * This is the SHARED-SHAPE projection of the envelope — used both as the
 * standalone {@link EventEnvelope} schema and as the base each event-type
 * struct extends with type-specific fields.
 *
 * Per ACVP invariants:
 *   - **CL-Event-3** (hash-determinism): event_id = SHA-256(canonical preimage)
 *   - **CL-Event-2** (hash-chain-continuity): source_event_hash references prior event (or null for root)
 *   - **CL-Event-5** (collision-distinguishing): caller-supplied nonce makes
 *     otherwise-identical events distinct (resolves SKP-002 HIGH)
 */
export const eventEnvelopeFields = {
  event_id: EventId,
  preimage_schema_id: Schema.String.pipe(
    Schema.pattern(/^https?:\/\/[^\s]+$/),
    Schema.minLength(1),
    Schema.maxLength(512),
  ),
  ts: RFC3339Date,
  source_event_hash: Schema.NullOr(EventId),
  nonce: Schema.NullOr(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128))),
  schema_version: Schema.Literal("1.0.0"),
  $id: Schema.String.pipe(
    Schema.pattern(/^https?:\/\/[^\s]+$/),
    Schema.minLength(1),
    Schema.maxLength(512),
  ),
} as const;

/**
 * EventEnvelope — the bare common-shape Schema.Struct (FR-5).
 *
 * Per-event types (ActivityCompleted, BadgeIssued, etc.) carry these fields
 * PLUS their event-specific extensions — see `events/<EventType>.ts` for each.
 */
export const EventEnvelope = Schema.Struct(eventEnvelopeFields);

export type EventEnvelope = Schema.Schema.Type<typeof EventEnvelope>;
