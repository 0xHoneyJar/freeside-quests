/**
 * QuestVerdict schema — the engine-internal envelope wrapping the
 * construct's judgment for the state-machine.
 *
 * Distinct from cycle-1 `SubstrateStepVerdict` (which is the Kafka-bound
 * substrate-step ABI). `QuestVerdict` is the engine-internal envelope that
 * wraps the construct's judgment for the state-machine.
 *
 * Cycle-Q · 2026-05-04 · sprint-2 ENGINE+PERSIST · SDD §3.4.
 */

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Verdict status — terminal-ish ladder
// ---------------------------------------------------------------------------

/**
 * Verdict status. APPROVED + REJECTED are terminal (state-machine
 * routes via `transitions.finalize`). NEEDS_HUMAN routes to operator
 * queue downstream.
 */
export const VerdictStatus = Schema.Literal("APPROVED", "REJECTED", "NEEDS_HUMAN");
export type VerdictStatus = Schema.Schema.Type<typeof VerdictStatus>;

// ---------------------------------------------------------------------------
// QuestVerdict — sealed shape
// ---------------------------------------------------------------------------

/**
 * QuestVerdict — what the construct emits and the engine consumes.
 *
 * Renderer SHOWS narrative + curator_voice_quote — NEVER status enum,
 * NEVER confidence (per [[chat-medium-presentation-boundary]] §2 drift sig).
 */
export const QuestVerdict = Schema.Struct({
  /** Mirrors SubmissionEnvelope.submission_id. */
  submission_id: Schema.String,
  /**
   * Mirrors SubmissionEnvelope.trace_id · NEVER user-visible.
   * The substrate-id-leak guard test (sprint-2 Q2.8) asserts this never
   * leaks into engine string outputs.
   */
  trace_id: Schema.String,
  status: VerdictStatus,
  confidence: Schema.Number.pipe(Schema.between(0, 1)),
  /**
   * Curator-voice prose — what the renderer SHOWS to the user.
   * Per [[mibera-as-npc]] §6.5 the curator authors phrasing like
   * "the steppe nods" · NEVER status enum or numeric confidence.
   * Per [[discord-native-register]] ≤180 words for digest budget ·
   * ≤1200 chars hard cap.
   */
  narrative: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1200)),
  /** Optional pull-quote that became the badge title. Per Mongolian voice. */
  curator_voice_quote: Schema.optional(
    Schema.String.pipe(Schema.maxLength(120)),
  ),
  /** Construct that emitted (kebab-case slug). */
  construct_slug: Schema.String.pipe(Schema.pattern(/^[a-z][a-z0-9-]*$/)),
  graded_at: Schema.String,
  contract_version: Schema.String.pipe(Schema.pattern(/^\d+\.\d+\.\d+$/)),
});
export type QuestVerdict = Schema.Schema.Type<typeof QuestVerdict>;
