/**
 * Quest state machine — pure transitions.
 *
 * Per SDD §4.1: pure functions · NO IO · NO side effects · NO state.
 * Adapters in `persistence/` wrap these with read-from / write-to port
 * operations. Boundary = `QuestStatePort` Tag.
 *
 * Per PRD D3 sealed phase enum + PRD §5 Karpathy "Simplicity First": these
 * transitions are 4 verbs (`accept` · `submit` · `judge` · `finalize`).
 * Every other path is `InvalidPhaseTransitionError`.
 *
 * Cycle-Q · 2026-05-04 · sprint-2 ENGINE+PERSIST.
 */

import { Effect } from "effect";
import {
  type QuestState,
  type QuestVerdict,
  type SubmissionEnvelope,
  InvalidPhaseTransitionError,
} from "@freeside-quests/protocol";

// ---------------------------------------------------------------------------
// Helpers — clock injection
// ---------------------------------------------------------------------------

/**
 * Clock interface for testable transitions. Default `systemClock` returns
 * `new Date().toISOString()`. Tests inject a fixed-time clock.
 */
export interface Clock {
  readonly now: () => string;
}

/** Default clock — wall-clock ISO datetime. */
export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Pure transitions
// ---------------------------------------------------------------------------

/**
 * `browsing` → `accepted`. Stamps `accepted_at`.
 *
 * Fails with `InvalidPhaseTransitionError` if state is not in `browsing`.
 */
export const accept = (
  state: QuestState,
  clock: Clock = systemClock,
): Effect.Effect<QuestState, InvalidPhaseTransitionError> =>
  state.phase !== "browsing"
    ? Effect.fail(
        new InvalidPhaseTransitionError({
          quest_id: state.quest_id,
          from_phase: state.phase,
          to_phase: "accepted",
          reason: "can only accept from browsing phase",
        }),
      )
    : Effect.succeed({
        ...state,
        phase: "accepted" as const,
        accepted_at: clock.now(),
      });

/**
 * `accepted` → `submitted`. Stamps `submitted_at` from
 * `submission.submitted_at` (gateway clock, not transition clock — keeps
 * the submission audit-trail consistent with the user's send-time).
 */
export const submit = (
  state: QuestState,
  submission: SubmissionEnvelope,
): Effect.Effect<QuestState, InvalidPhaseTransitionError> =>
  state.phase !== "accepted"
    ? Effect.fail(
        new InvalidPhaseTransitionError({
          quest_id: state.quest_id,
          from_phase: state.phase,
          to_phase: "submitted",
          reason: "can only submit from accepted phase",
        }),
      )
    : Effect.succeed({
        ...state,
        phase: "submitted" as const,
        submitted_at: submission.submitted_at,
      });

/**
 * `submitted` → `judged`. Stamps `judged_at` from `verdict.graded_at`.
 *
 * Embeds the verdict snapshot (`status` · `confidence` · `narrative` ·
 * optional `curator_voice_quote`) into `state.verdict` for renderer +
 * audit. The construct's submission_id / trace_id are NOT embedded — they
 * stay telemetry-only per CMP-boundary §2 drift signature.
 */
export const judge = (
  state: QuestState,
  verdict: QuestVerdict,
): Effect.Effect<QuestState, InvalidPhaseTransitionError> =>
  state.phase !== "submitted"
    ? Effect.fail(
        new InvalidPhaseTransitionError({
          quest_id: state.quest_id,
          from_phase: state.phase,
          to_phase: "judged",
          reason: "can only judge from submitted phase",
        }),
      )
    : Effect.succeed({
        ...state,
        phase: "judged" as const,
        judged_at: verdict.graded_at,
        verdict: {
          status: verdict.status,
          confidence: verdict.confidence,
          narrative: verdict.narrative,
          ...(verdict.curator_voice_quote === undefined
            ? {}
            : { curator_voice_quote: verdict.curator_voice_quote }),
        },
      });

/**
 * `judged` → `completed` (APPROVED) OR `judged` → `failed` (REJECTED or
 * NEEDS_HUMAN). Stamps `completed_at`. APPROVED variants accept an
 * optional `badge_uri` (null/undefined = anon-badge-gated path per PRD D4).
 *
 * NEEDS_HUMAN routes to `failed` here for substrate purposes — operator
 * queue handling is downstream (a separate cycle's concern). The
 * verdict.status is preserved in `state.verdict.status` so consumers
 * can distinguish.
 */
export const finalize = (
  state: QuestState,
  badge_uri?: string,
  clock: Clock = systemClock,
): Effect.Effect<QuestState, InvalidPhaseTransitionError> => {
  if (state.phase !== "judged") {
    return Effect.fail(
      new InvalidPhaseTransitionError({
        quest_id: state.quest_id,
        from_phase: state.phase,
        to_phase: "completed/failed",
        reason: "can only finalize from judged phase",
      }),
    );
  }
  const completed_at = clock.now();
  if (state.verdict?.status === "APPROVED") {
    return Effect.succeed({
      ...state,
      phase: "completed" as const,
      completed_at,
      ...(badge_uri === undefined ? {} : { badge_uri }),
    });
  }
  return Effect.succeed({
    ...state,
    phase: "failed" as const,
    completed_at,
  });
};

// ---------------------------------------------------------------------------
// Aggregate export
// ---------------------------------------------------------------------------

/**
 * The state-machine surface. Tests + adapters import either the named
 * functions above or this aggregate.
 */
export const transitions = {
  accept,
  submit,
  judge,
  finalize,
} as const;
