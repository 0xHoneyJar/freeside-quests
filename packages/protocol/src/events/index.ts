/**
 * Event-stream schemas (FR-5 · cycle acvp-modules-genesis · sprint-1 · T1.7).
 *
 * 7 event types, all extending the shared {@link EventEnvelope} shape:
 *   - ActivityCompleted
 *   - BadgeIssued
 *   - RaffleDrawn
 *   - ProgressAdvanced
 *   - RewardPendingEvent
 *   - RewardGrantedEvent
 *   - RewardFailedEvent
 *
 * Per ACVP invariants (CL-Event-1..5):
 *   - every Activity state mutation emits ≥1 event
 *   - source_event_hash threads a hash-chain (or null for root)
 *   - event_id = SHA-256(canonical preimage) — see preimage/ + compute-event-id.ts
 *   - canonical encoding is RFC 8785 JCS after stripping event_id from the preimage
 *   - caller-supplied nonce distinguishes otherwise-identical events (SKP-002)
 */

export { ActivityCompleted } from "./ActivityCompleted.js";
export { BadgeIssued } from "./BadgeIssued.js";
export { computeEventId, computeEventIdSync, isMutatingEvent } from "./compute-event-id.js";
export { EventEnvelope, eventEnvelopeFields } from "./EventEnvelope.js";
export {
  CASFailed,
  CanonicalizationFailed,
  DuplicateEvent,
  EventError,
  EventStoreUnavailable,
  NonceCollision,
  NonceRequired,
  PartitionScopeMismatch,
  SchemaValidation,
} from "./EventError.js";
export { ProgressAdvanced } from "./ProgressAdvanced.js";
export { RaffleDrawn } from "./RaffleDrawn.js";
export { RewardFailedEvent } from "./RewardFailedEvent.js";
export { RewardGrantedEvent } from "./RewardGrantedEvent.js";
export { RewardPendingEvent } from "./RewardPendingEvent.js";
