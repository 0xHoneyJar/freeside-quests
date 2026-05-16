/**
 * @0xhoneyjar/quests-protocol — sealed wire-format schemas for quest engagement.
 *
 * Cycle-1 (2026-05-03) lands the substrate-step submission/verdict pair —
 * the over-the-wire envelope for substrate-graded activity steps in
 * cubquests-interface (instance-N of the substrate-mental-model doctrine).
 *
 * Cycle-Q (2026-05-04) lands the quest entity + state + envelopes:
 *   - Quest, QuestId, NpcId, RubricPointer, BadgeSpec
 *   - QuestState, QuestPhase, PlayerIdentity, PlayerWallet, DiscordId
 *   - SubmissionEnvelope, ContextMessage, SubmissionId
 *   - QuestVerdict, VerdictStatus
 *   - BadgeArtifact, BadgeURI
 *   - tagged errors (QuestNotFoundError · InvalidPhaseTransitionError ·
 *     StateDecodeError · PersistenceError · NotImplementedError)
 *
 * Future cycles will land:
 *   - quest-completion event schema (Kafka envelope)
 *   - webhook payload schema
 *   - additional branded types (BadgeId, CompletionEventId, PartnerSlug)
 */

// ---------------------------------------------------------------------------
// Cycle-1 (substrate-step ABI · 2026-05-03)
// ---------------------------------------------------------------------------

export {
  SubstrateStepPayload,
  SubstrateStepSubmission,
  SubstrateStepVerdict,
  SUBSTRATE_STEP_CONTRACT_VERSION,
  // Re-exported as `SubstrateStepVerdictStatus` to disambiguate from Cycle-Q's
  // `VerdictStatus` (they share shape today; namespace separation lets either
  // side evolve without breaking the other).
  VerdictStatus as SubstrateStepVerdictStatus,
} from "./substrate-step.js";

// ---------------------------------------------------------------------------
// Cycle-Q (quest UI substrate · 2026-05-04 · SDD §3)
// ---------------------------------------------------------------------------

// Quest entity (§3.1)
export {
  Quest,
  QuestId,
  NpcId,
  BadgeFamilyId,
  WorldSlug,
  RubricPointer,
  BadgeSpec,
  QUEST_CONTRACT_VERSION,
} from "./quest.js";

// Quest state (§3.2)
export {
  QuestState,
  QuestPhase,
  PlayerIdentity,
  PlayerWallet,
  DiscordId,
  VerdictSnapshot,
} from "./quest-state.js";

// Submission envelope (§3.3)
export {
  SubmissionEnvelope,
  SubmissionId,
  ContextMessage,
} from "./submission.js";

// Quest verdict (§3.4)
export { QuestVerdict, VerdictStatus } from "./quest-verdict.js";

// Badge artifact (§3.5)
export { BadgeArtifact, BadgeURI } from "./badge-artifact.js";

// Errors (§3.6)
export {
  QuestNotFoundError,
  InvalidPhaseTransitionError,
  StateDecodeError,
  PersistenceError,
  NotImplementedError,
} from "./errors.js";
export type { QuestEngineError } from "./errors.js";

// ---------------------------------------------------------------------------
// acvp-modules-genesis · Sprint 1 (2026-05-15)
// Activity substrate branded types (SDD §5.2 + §3.1)
// ---------------------------------------------------------------------------

export {
  ActivityId,
  CycleId,
  EventId,
  IdentityId,
  MintIntentId,
  PartitionKey,
  PartitionScope,
  SnapshotId,
  StepId,
  WorldId,
} from "./branded/index.js";
