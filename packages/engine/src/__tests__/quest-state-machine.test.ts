/**
 * Quest state-machine — pure transition tests.
 *
 * Per SDD §9.2 AC-2.2: 100% phase-transition coverage. Every legal
 * transition is exercised; every illegal transition is asserted to fail
 * with `InvalidPhaseTransitionError`.
 *
 * Cycle-Q · 2026-05-04 · sprint-2 ENGINE+PERSIST.
 */

import { describe, expect, it } from "vitest";
import { Effect, Either, Schema } from "effect";

import {
  accept,
  submit,
  judge,
  finalize,
  transitions,
  type Clock,
} from "../quest-state-machine.js";
import {
  type QuestState,
  type QuestPhase,
  type QuestVerdict,
  type SubmissionEnvelope,
  QuestId,
  NpcId,
  PlayerWallet,
  DiscordId,
} from "@freeside-quests/protocol";

/**
 * Run an Effect that may fail with a tagged error and assert the failure
 * carries the expected `_tag`. This is the canonical Effect pattern for
 * testing tagged failures (vs `.rejects.toThrow` which collapses the tag).
 */
async function expectFailureTag<E extends { readonly _tag: string }>(
  program: Effect.Effect<unknown, E>,
  tag: E["_tag"],
): Promise<E> {
  const result = await Effect.runPromise(Effect.either(program));
  if (Either.isRight(result)) {
    throw new Error(`Expected failure with _tag=${tag}, got success`);
  }
  expect(result.left._tag).toBe(tag);
  return result.left;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_CLOCK_NOW = "2026-05-04T18:00:00.000Z";
const fixedClock: Clock = { now: () => FIXED_CLOCK_NOW };

const QUEST_ID = Schema.decodeSync(QuestId)("quest-mongolian-001");
const NPC_ID = Schema.decodeSync(NpcId)("mongolian");
const WALLET = Schema.decodeSync(PlayerWallet)(`0x${"a".repeat(40)}`);
const DISCORD = Schema.decodeSync(DiscordId)("123456789012345678");

const baseState = (phase: QuestPhase, overrides: Partial<QuestState> = {}): QuestState => ({
  quest_id: QUEST_ID,
  player: { type: "verified", wallet: WALLET, discord_id: DISCORD },
  npc_id: NPC_ID,
  phase,
  trace_id: "trace-01HW8SAMPLE",
  contract_version: "1.0.0",
  ...overrides,
});

const makeSubmission = (overrides: Partial<SubmissionEnvelope> = {}): SubmissionEnvelope => ({
  submission_id: "sub-01HW8SAMPLE" as SubmissionEnvelope["submission_id"],
  trace_id: "trace-01HW8SAMPLE",
  quest_id: QUEST_ID,
  player: { type: "verified", wallet: WALLET, discord_id: DISCORD },
  text_response: "Steppe wind etched the answer; I am still listening for it.",
  submitted_at: "2026-05-04T17:30:00.000Z",
  contract_version: "1.0.0",
  ...overrides,
});

const makeVerdict = (overrides: Partial<QuestVerdict> = {}): QuestVerdict => ({
  submission_id: "sub-01HW8SAMPLE",
  trace_id: "trace-01HW8SAMPLE",
  status: "APPROVED",
  confidence: 0.84,
  narrative: "the steppe nods · your stillness was the point",
  curator_voice_quote: "the steppe nods",
  construct_slug: "mongolian-grader",
  graded_at: "2026-05-04T17:45:00.000Z",
  contract_version: "1.0.0",
  ...overrides,
});

// ---------------------------------------------------------------------------
// accept · browsing → accepted
// ---------------------------------------------------------------------------

describe("transitions.accept", () => {
  it("transitions browsing → accepted with stamped accepted_at", async () => {
    const state = baseState("browsing");
    const next = await Effect.runPromise(accept(state, fixedClock));

    expect(next.phase).toBe("accepted");
    expect(next.accepted_at).toBe(FIXED_CLOCK_NOW);
    expect(next.quest_id).toBe(state.quest_id);
    expect(next.player).toEqual(state.player);
    // Original state unchanged (immutability check).
    expect(state.phase).toBe("browsing");
    expect(state.accepted_at).toBeUndefined();
  });

  it("rejects accept from accepted phase", async () => {
    const state = baseState("accepted");
    const err = await expectFailureTag(accept(state), "InvalidPhaseTransitionError");
    expect(err.from_phase).toBe("accepted");
    expect(err.to_phase).toBe("accepted");
  });

  it("rejects accept from submitted/judged/completed/failed phases", async () => {
    for (const phase of ["submitted", "judged", "completed", "failed"] as const) {
      const state = baseState(phase);
      const err = await expectFailureTag(accept(state), "InvalidPhaseTransitionError");
      expect(err.from_phase).toBe(phase);
    }
  });

  it("uses systemClock by default when no clock passed", async () => {
    const state = baseState("browsing");
    const next = await Effect.runPromise(accept(state));
    // Default clock returns ISO datetime · just assert shape.
    expect(next.accepted_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ---------------------------------------------------------------------------
// submit · accepted → submitted
// ---------------------------------------------------------------------------

describe("transitions.submit", () => {
  it("transitions accepted → submitted with submission.submitted_at preserved", async () => {
    const state = baseState("accepted", { accepted_at: FIXED_CLOCK_NOW });
    const submission = makeSubmission();
    const next = await Effect.runPromise(submit(state, submission));

    expect(next.phase).toBe("submitted");
    expect(next.submitted_at).toBe(submission.submitted_at);
    // accepted_at preserved across transition.
    expect(next.accepted_at).toBe(FIXED_CLOCK_NOW);
  });

  it("rejects submit from browsing phase", async () => {
    const state = baseState("browsing");
    const err = await expectFailureTag(
      submit(state, makeSubmission()),
      "InvalidPhaseTransitionError",
    );
    expect(err.from_phase).toBe("browsing");
    expect(err.to_phase).toBe("submitted");
  });

  it("rejects submit from submitted/judged/completed/failed phases", async () => {
    for (const phase of ["submitted", "judged", "completed", "failed"] as const) {
      const state = baseState(phase);
      const err = await expectFailureTag(
        submit(state, makeSubmission()),
        "InvalidPhaseTransitionError",
      );
      expect(err.from_phase).toBe(phase);
    }
  });
});

// ---------------------------------------------------------------------------
// judge · submitted → judged
// ---------------------------------------------------------------------------

describe("transitions.judge", () => {
  it("transitions submitted → judged with verdict snapshot embedded", async () => {
    const state = baseState("submitted", {
      accepted_at: FIXED_CLOCK_NOW,
      submitted_at: "2026-05-04T17:30:00.000Z",
    });
    const verdict = makeVerdict({ status: "APPROVED" });
    const next = await Effect.runPromise(judge(state, verdict));

    expect(next.phase).toBe("judged");
    expect(next.judged_at).toBe(verdict.graded_at);
    expect(next.verdict).toEqual({
      status: "APPROVED",
      confidence: verdict.confidence,
      narrative: verdict.narrative,
      curator_voice_quote: verdict.curator_voice_quote,
    });
  });

  it("preserves narrative + curator_voice_quote (CMP boundary fields)", async () => {
    const state = baseState("submitted");
    const verdict = makeVerdict({
      narrative: "the steppe is quiet",
      curator_voice_quote: "stillness",
    });
    const next = await Effect.runPromise(judge(state, verdict));
    expect(next.verdict?.narrative).toBe("the steppe is quiet");
    expect(next.verdict?.curator_voice_quote).toBe("stillness");
  });

  it("does NOT embed submission_id or trace_id into the verdict snapshot", async () => {
    const state = baseState("submitted");
    const verdict = makeVerdict({
      submission_id: "sub-LEAK-CHECK",
      trace_id: "trace-LEAK-CHECK",
    });
    const next = await Effect.runPromise(judge(state, verdict));
    const verdictKeys = Object.keys(next.verdict ?? {});
    expect(verdictKeys).not.toContain("submission_id");
    expect(verdictKeys).not.toContain("trace_id");
  });

  it("handles missing curator_voice_quote (optional field)", async () => {
    const state = baseState("submitted");
    const verdict = makeVerdict({ curator_voice_quote: undefined });
    const next = await Effect.runPromise(judge(state, verdict));
    expect(next.verdict?.curator_voice_quote).toBeUndefined();
  });

  it("rejects judge from non-submitted phases", async () => {
    for (const phase of ["browsing", "accepted", "judged", "completed", "failed"] as const) {
      const state = baseState(phase);
      const err = await expectFailureTag(
        judge(state, makeVerdict()),
        "InvalidPhaseTransitionError",
      );
      expect(err.from_phase).toBe(phase);
    }
  });
});

// ---------------------------------------------------------------------------
// finalize · judged → completed (APPROVED) OR failed (REJECTED/NEEDS_HUMAN)
// ---------------------------------------------------------------------------

describe("transitions.finalize", () => {
  it("transitions judged + APPROVED → completed with badge_uri", async () => {
    const state = baseState("judged", {
      verdict: {
        status: "APPROVED",
        confidence: 0.84,
        narrative: "ok",
      },
    });
    const next = await Effect.runPromise(
      finalize(state, "https://example.com/badge.png", fixedClock),
    );
    expect(next.phase).toBe("completed");
    expect(next.completed_at).toBe(FIXED_CLOCK_NOW);
    expect(next.badge_uri).toBe("https://example.com/badge.png");
  });

  it("transitions judged + APPROVED → completed with no badge_uri (anon path)", async () => {
    const state = baseState("judged", {
      verdict: { status: "APPROVED", confidence: 0.84, narrative: "ok" },
    });
    const next = await Effect.runPromise(finalize(state, undefined, fixedClock));
    expect(next.phase).toBe("completed");
    expect(next.badge_uri).toBeUndefined();
  });

  it("transitions judged + REJECTED → failed", async () => {
    const state = baseState("judged", {
      verdict: { status: "REJECTED", confidence: 0.4, narrative: "miss" },
    });
    const next = await Effect.runPromise(finalize(state, undefined, fixedClock));
    expect(next.phase).toBe("failed");
    expect(next.completed_at).toBe(FIXED_CLOCK_NOW);
    expect(next.badge_uri).toBeUndefined();
  });

  it("transitions judged + NEEDS_HUMAN → failed (operator queue downstream)", async () => {
    const state = baseState("judged", {
      verdict: { status: "NEEDS_HUMAN", confidence: 0.5, narrative: "ambig" },
    });
    const next = await Effect.runPromise(finalize(state, undefined, fixedClock));
    expect(next.phase).toBe("failed");
    expect(next.verdict?.status).toBe("NEEDS_HUMAN");
  });

  it("rejects finalize from browsing/accepted/submitted/completed/failed phases", async () => {
    for (const phase of ["browsing", "accepted", "submitted", "completed", "failed"] as const) {
      const state = baseState(phase);
      const err = await expectFailureTag(
        finalize(state),
        "InvalidPhaseTransitionError",
      );
      expect(err.from_phase).toBe(phase);
    }
  });

  it("rejects finalize from judged with no embedded verdict (defensive · routes to failed)", async () => {
    // verdict is optional in QuestState · if judge() never ran, finalize should
    // treat absent verdict as not-APPROVED → failed.
    const state = baseState("judged");
    const next = await Effect.runPromise(finalize(state, undefined, fixedClock));
    expect(next.phase).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// Aggregate export sanity
// ---------------------------------------------------------------------------

describe("transitions aggregate export", () => {
  it("exports all 4 transition verbs", () => {
    expect(typeof transitions.accept).toBe("function");
    expect(typeof transitions.submit).toBe("function");
    expect(typeof transitions.judge).toBe("function");
    expect(typeof transitions.finalize).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Integration: full happy path browsing → accepted → submitted → judged → completed
// ---------------------------------------------------------------------------

describe("full happy-path integration", () => {
  it("walks browsing → accepted → submitted → judged → completed", async () => {
    const initial = baseState("browsing");
    const submission = makeSubmission();
    const verdict = makeVerdict({ status: "APPROVED" });

    const program = Effect.gen(function* () {
      const accepted = yield* accept(initial, fixedClock);
      const submitted = yield* submit(accepted, submission);
      const judged = yield* judge(submitted, verdict);
      const completed = yield* finalize(judged, "https://example.com/badge.png", fixedClock);
      return completed;
    });

    const result = await Effect.runPromise(program);
    expect(result.phase).toBe("completed");
    expect(result.accepted_at).toBe(FIXED_CLOCK_NOW);
    expect(result.submitted_at).toBe(submission.submitted_at);
    expect(result.judged_at).toBe(verdict.graded_at);
    expect(result.completed_at).toBe(FIXED_CLOCK_NOW);
    expect(result.badge_uri).toBe("https://example.com/badge.png");
    expect(result.verdict?.status).toBe("APPROVED");
  });

  it("walks browsing → accepted → submitted → judged → failed (REJECTED)", async () => {
    const initial = baseState("browsing");
    const submission = makeSubmission();
    const verdict = makeVerdict({ status: "REJECTED", narrative: "off-rubric" });

    const program = Effect.gen(function* () {
      const accepted = yield* accept(initial, fixedClock);
      const submitted = yield* submit(accepted, submission);
      const judged = yield* judge(submitted, verdict);
      const failed = yield* finalize(judged, undefined, fixedClock);
      return failed;
    });

    const result = await Effect.runPromise(program);
    expect(result.phase).toBe("failed");
    expect(result.verdict?.status).toBe("REJECTED");
    expect(result.badge_uri).toBeUndefined();
  });
});
