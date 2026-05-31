import { Schema } from "effect";

/**
 * EventError — sealed TaggedStruct union covering every failure mode the
 * substrate may surface when constructing, validating, or hashing events
 * (FR-5 · FR-11 + Fix-A1 · per SDD §4.2 + §Fix-A1).
 *
 * Variants:
 *   - NonceRequired        → caller omitted nonce on a mutating event (Fix-A1)
 *   - NonceCollision       → two events with identical preimage AND nonce
 *   - SchemaValidation     → event failed Schema decode (PERMANENT bad input → 422)
 *   - DuplicateEvent       → adapter rejected duplicate event_id append
 *   - CASFailed            → optimistic concurrency check failed during append
 *   - PartitionScopeMismatch → event's partition_key.scope rejected by store
 *   - CanonicalizationFailed → JCS canonicalization could not produce a string
 *   - EventStoreUnavailable  → infra-transient adapter fault (db unreachable,
 *       pool exhaustion, serialization storm exhausting retries). RETRYABLE →
 *       503. Distinct from SchemaValidation, which is a PERMANENT bad-input
 *       failure → 422. (Write-path defect #21.8 fix: a retry-exhausted
 *       serialization storm was previously mis-tagged SchemaValidation, hiding
 *       a transient infra fault behind a permanent client-error status.)
 *
 * All variants carry just enough context for the caller to act (reason,
 * event_type, conflicting_event_id, etc.) — no PII, no raw payload leaks.
 *
 * BACKWARD-COMPATIBILITY NOTE (defect #21.8 · ADDITIVE change): the
 * `EventStoreUnavailable` variant was ADDED to the sealed union. No existing
 * variant was changed or removed. Exhaustive matchers over `EventError` now
 * see one more arm; consumers that already `default`-handle unknown tags (the
 * route layer's `HTTP_FOR_TAG[tag] ?? 500` is one) keep working. This is a
 * forward-compatible contract extension required for correctness.
 */
export const NonceRequired = Schema.TaggedStruct("NonceRequired", {
  event_type: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512)),
  reason: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),
});

export const NonceCollision = Schema.TaggedStruct("NonceCollision", {
  event_type: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512)),
  conflicting_event_id: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
});

export const SchemaValidation = Schema.TaggedStruct("SchemaValidation", {
  event_type: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512)),
  detail: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1024)),
});

export const DuplicateEvent = Schema.TaggedStruct("DuplicateEvent", {
  existing_event_id: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
});

export const CASFailed = Schema.TaggedStruct("CASFailed", {
  expected_version: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  actual_version: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export const PartitionScopeMismatch = Schema.TaggedStruct("PartitionScopeMismatch", {
  expected_scope: Schema.String,
  actual_scope: Schema.String,
});

export const CanonicalizationFailed = Schema.TaggedStruct("CanonicalizationFailed", {
  reason: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),
});

/**
 * EventStoreUnavailable — infra-transient adapter fault surfaced by the
 * event-store append path (defect #21.8 fix). RETRYABLE: the caller may retry
 * the SAME append (idempotent under the event_id PK) after backoff. Maps to
 * HTTP 503 at the route boundary, NEVER 422 — a 422 would tell the client the
 * input is permanently bad, when in fact the store was momentarily unreachable.
 */
export const EventStoreUnavailable = Schema.TaggedStruct("EventStoreUnavailable", {
  event_type: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512)),
  reason: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1024)),
  retryable: Schema.Boolean,
});

export const EventError = Schema.Union(
  NonceRequired,
  NonceCollision,
  SchemaValidation,
  DuplicateEvent,
  CASFailed,
  PartitionScopeMismatch,
  CanonicalizationFailed,
  EventStoreUnavailable,
);

export type EventError = Schema.Schema.Type<typeof EventError>;
