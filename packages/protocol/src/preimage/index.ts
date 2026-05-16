/**
 * Canonical preimage schemas (§5.6 · cycle acvp-modules-genesis · sprint-1 · T1.8).
 *
 * Per-event preimage shapes that document the EXPLICIT field-exclusion rule:
 * every preimage is the corresponding event Schema.Struct MINUS the
 * `event_id` field.
 *
 * The exclusion is the lock that makes `event_id = SHA-256(canonical(preimage))`
 * close cleanly (CL-Event-3 hash-determinism). Including `event_id` in the
 * preimage would create a self-reference — the hash would need to be known
 * before it could be computed.
 *
 * `step_completions` arrays are canonically sorted by `(order, step_id)`
 * BEFORE hashing (§5.6 tie-break rule). The Schema.Struct here declares the
 * shape; `computeEventId` applies the sort at hash time.
 *
 * Cross-runtime ports (Rust · Python · etc.) can reference these schemas to
 * confirm they hash the same field-set the reference implementation hashes.
 */

export { ActivityCompletedPreimage } from "./ActivityCompletedPreimage.js";
export { BadgeIssuedPreimage } from "./BadgeIssuedPreimage.js";
export { PreimageEnvelope, preimageEnvelopeFields } from "./PreimageEnvelope.js";
export { ProgressAdvancedPreimage } from "./ProgressAdvancedPreimage.js";
export { RaffleDrawnPreimage } from "./RaffleDrawnPreimage.js";
export { RewardFailedPreimage } from "./RewardFailedPreimage.js";
export { RewardGrantedPreimage } from "./RewardGrantedPreimage.js";
export { RewardPendingPreimage } from "./RewardPendingPreimage.js";
