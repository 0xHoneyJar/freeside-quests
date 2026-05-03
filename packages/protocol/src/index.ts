/**
 * @freeside-quests/protocol — sealed wire-format schemas for quest engagement.
 *
 * Cycle-1 (2026-05-03) lands the substrate-step submission/verdict pair —
 * the over-the-wire envelope for substrate-graded activity steps in
 * cubquests-interface (instance-N of the substrate-mental-model doctrine).
 *
 * Future cycles will land:
 *   - quest definition schema (Quest, Badge, Raffle, Completion shapes per
 *     freeside-quests/docs/EXTRACTION-MAP.md)
 *   - quest-completion event schema (Kafka envelope)
 *   - webhook payload schema
 *   - branded types (QuestId, BadgeId, CompletionEventId, PartnerSlug)
 */

export {
  SubstrateStepPayload,
  SubstrateStepSubmission,
  SubstrateStepVerdict,
  SUBSTRATE_STEP_CONTRACT_VERSION,
  VerdictStatus,
} from "./substrate-step.js";
