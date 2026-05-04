/**
 * SubmissionEnvelope schema — what the player produces.
 *
 * Mirrors `substrate-step.ts` `SubstrateStepPayload` but quest-shaped.
 * Per PRD D2 (renderer supports both inline AND modal submission flows).
 *
 * Cycle-Q · 2026-05-04 · sprint-2 ENGINE+PERSIST · SDD §3.3.
 */

import { Schema } from "effect";
import { QuestId } from "./quest.js";
import { PlayerIdentity } from "./quest-state.js";

// ---------------------------------------------------------------------------
// Branded submission identifier
// ---------------------------------------------------------------------------

/** Submission ID — UUID minted at submit time · 1-1 with verdict trace. */
export const SubmissionId = Schema.String.pipe(
  Schema.brand("SubmissionId"),
  Schema.minLength(1),
);
export type SubmissionId = Schema.Schema.Type<typeof SubmissionId>;

// ---------------------------------------------------------------------------
// Context message — bounded thread-history snapshot
// ---------------------------------------------------------------------------

/**
 * A single thread/channel message included as context for the construct.
 * Per kickoff §9.5 principle 2: inline-reply context lets the construct
 * read the player's recent messages to ground the verdict.
 */
export const ContextMessage = Schema.Struct({
  author: Schema.String,
  content: Schema.String.pipe(Schema.maxLength(2000)),
  timestamp: Schema.String,
});
export type ContextMessage = Schema.Schema.Type<typeof ContextMessage>;

// ---------------------------------------------------------------------------
// SubmissionEnvelope
// ---------------------------------------------------------------------------

/**
 * SubmissionEnvelope — what the player produces.
 *
 * Mirrors substrate-step.ts SubstrateStepPayload but quest-shaped.
 * Per PRD D2 (renderer supports both inline AND modal).
 */
export const SubmissionEnvelope = Schema.Struct({
  submission_id: SubmissionId,
  /**
   * Telemetry trace id · NEVER user-visible per CMP-boundary §2 drift sig.
   * The substrate-id-leak guard test (sprint-2 Q2.8) asserts this string
   * never leaks into engine string outputs.
   */
  trace_id: Schema.String.pipe(Schema.minLength(1)),
  quest_id: QuestId,
  player: PlayerIdentity,
  /** User's text response — bounded per [[discord-native-register]]. */
  text_response: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(4000),
  ),
  /**
   * Optional thread/channel context — last N messages for the construct
   * to read inline-reply context. Per kickoff §9.5 principle 2.
   */
  context_messages: Schema.optional(
    Schema.Array(ContextMessage).pipe(Schema.maxItems(20)),
  ),
  /** Optional URLs (image proofs, links). Bounded. */
  evidence_urls: Schema.optional(
    Schema.Array(Schema.String.pipe(Schema.minLength(1))).pipe(
      Schema.maxItems(5),
    ),
  ),
  submitted_at: Schema.String,
  contract_version: Schema.String.pipe(Schema.pattern(/^\d+\.\d+\.\d+$/)),
});
export type SubmissionEnvelope = Schema.Schema.Type<typeof SubmissionEnvelope>;
