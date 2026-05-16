import { Schema } from "effect";

import { EventId } from "../branded/EventId.js";
import { RFC3339Date } from "../encoding/date.js";

/**
 * Common-shape fields the CANONICAL PREIMAGE carries (§5.6 · T1.8).
 *
 * This is the wire envelope MINUS `event_id`. The exclusion is the lock that
 * makes the hash-chain self-referentially safe: if `event_id` were included
 * in the preimage, computing it would require knowing it. Excluding `event_id`
 * lets `event_id = SHA-256(canonical(preimage))` close cleanly (CL-Event-3).
 *
 * Per-event preimage schemas (e.g. `ActivityCompletedPreimage`) extend this
 * with their event-specific fields.
 *
 * The preimage is what `computeEventId` canonicalizes via RFC 8785 JCS. These
 * schemas document the shape explicitly so:
 *   - Golden vectors (T1.11) can validate fixture inputs against the preimage
 *     shape before computing hashes.
 *   - Cross-runtime ports (Rust, Python) can reference the field-set the
 *     reference implementation hashes.
 *   - A reader can see the "what is excluded" surface without grepping
 *     `compute-event-id.ts` for the field-strip logic.
 */
export const preimageEnvelopeFields = {
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
 * PreimageEnvelope — the bare common-shape preimage struct.
 *
 * Identical to `EventEnvelope` MINUS `event_id`. Caller-visible documentation
 * of the exclusion rule from §5.6 / Fix-A1.
 */
export const PreimageEnvelope = Schema.Struct(preimageEnvelopeFields);

export type PreimageEnvelope = Schema.Schema.Type<typeof PreimageEnvelope>;
