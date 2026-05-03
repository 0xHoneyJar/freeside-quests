/**
 * Smoke tests for the substrate-step dispatcher.
 *
 * The dispatcher is generic over any grader conforming to the
 * EssayGraderInput → EssayGraderOutput shape. These tests inline a
 * mock grader so the test suite does NOT depend on
 * @loa-constructs/lore-essay-grader resolving — that cross-workspace
 * coupling lives at the consumer (the world's app), not here.
 *
 * The construct's own tests (in loa-constructs/.claude/constructs/packs/
 * lore-essay-grader/src/__tests__/grader.test.ts) prove the grader's
 * Effect logic in isolation. These tests prove the bridging.
 *
 * End-to-end smoke (Plane-1 schema + Plane-2 grader + Plane-3 dispatch)
 * happens by running BOTH test suites — each suite covers one plane's
 * boundary, the seams are typed.
 */

import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { dispatchEssayQuest, dispatchAndResolve } from "../dispatch.js";
import type {
  EssayGraderInput,
  EssayGraderOutput,
  ResolutionHandlers,
} from "../dispatch.js";
import type { SubstrateStepSubmission, SubstrateStepVerdict } from "@freeside-quests/protocol";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const makeSubmission = (
  overrides: Partial<SubstrateStepSubmission> = {},
): SubstrateStepSubmission => ({
  submissionId: "01HW7SAMPLE",
  traceId: "trace-01HW7SAMPLE",
  activityId: "act-the-dark-grail",
  activitySlug: "the-dark-grail",
  stepId: "lore-essay-step",
  walletAddress: `0x${"a".repeat(40)}`,
  payload: {
    type: "essay",
    essay:
      "The dark grail does not gleam — it absorbs. Where the third grail reflects, this one swallows the reflection itself.",
  },
  submittedAt: "2026-05-03T18:00:00.000Z",
  contractVersion: "1.0.0",
  ...overrides,
});

const RUBRIC = {
  prompt: "What does the dark grail mean to you? In 1–2 sentences.",
  loreContext:
    "The dark grail is the inversion of the third grail; it is referenced in the codex as a sink, not a source.",
  passThreshold: 0.6,
};

const APPROVED_GRADER = (input: EssayGraderInput): Effect.Effect<EssayGraderOutput> =>
  Effect.succeed({
    status: "APPROVED",
    confidence: 0.83,
    reasoning:
      "The phrase 'absorbs' grounds in the codex's 'sink' framing; voice matches.",
    dimensions: { loreFit: 0.85, voiceMatch: 0.82, specificity: 0.8 },
    submissionId: input.submissionId,
    traceId: input.traceId,
  });

const REJECTED_GRADER = (input: EssayGraderInput): Effect.Effect<EssayGraderOutput> =>
  Effect.succeed({
    status: "REJECTED",
    confidence: 0.7,
    reasoning: "Vague gesture without grounding. Specificity 0.2.",
    dimensions: { loreFit: 0.4, voiceMatch: 0.5, specificity: 0.2 },
    submissionId: input.submissionId,
    traceId: input.traceId,
  });

// ---------------------------------------------------------------------------
// dispatchEssayQuest — bridging tests
// ---------------------------------------------------------------------------

describe("dispatchEssayQuest", () => {
  it("bridges an APPROVED submission to a SubstrateStepVerdict", async () => {
    const verdict = await Effect.runPromise(
      dispatchEssayQuest({
        submission: makeSubmission(),
        rubric: RUBRIC,
        grader: APPROVED_GRADER,
        graderConstructSlug: "lore-essay-grader",
      }),
    );

    expect(verdict.status).toBe("APPROVED");
    expect(verdict.confidence).toBe(0.83);
    expect(verdict.submissionId).toBe("01HW7SAMPLE");
    expect(verdict.traceId).toBe("trace-01HW7SAMPLE");
    expect(verdict.graderConstructSlug).toBe("lore-essay-grader");
    expect(verdict.contractVersion).toBe("1.0.0");
    expect(verdict.dimensions).toEqual({
      loreFit: 0.85,
      voiceMatch: 0.82,
      specificity: 0.8,
    });
    // gradedAt must be a valid ISO datetime
    expect(verdict.gradedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("bridges a REJECTED submission and propagates dimensions", async () => {
    const verdict = await Effect.runPromise(
      dispatchEssayQuest({
        submission: makeSubmission(),
        rubric: RUBRIC,
        grader: REJECTED_GRADER,
        graderConstructSlug: "lore-essay-grader",
      }),
    );

    expect(verdict.status).toBe("REJECTED");
    expect(verdict.dimensions?.specificity).toBe(0.2);
    expect(verdict.reasoning).toContain("Vague gesture");
  });

  it("rejects a submission with non-essay payload type (DispatchError)", async () => {
    const submission = makeSubmission({
      payload: { type: "url", url: "https://example.com/proof.png" },
    });

    const exit = await Effect.runPromiseExit(
      dispatchEssayQuest({
        submission,
        rubric: RUBRIC,
        grader: APPROVED_GRADER,
        graderConstructSlug: "lore-essay-grader",
      }),
    );

    expect(exit._tag).toBe("Failure");
  });

  it("rejects a malformed submission (Schema.decodeUnknown defense-in-depth)", async () => {
    const malformed = {
      ...makeSubmission(),
      walletAddress: "not-an-eth-address",
    } as unknown as SubstrateStepSubmission;

    const exit = await Effect.runPromiseExit(
      dispatchEssayQuest({
        submission: malformed,
        rubric: RUBRIC,
        grader: APPROVED_GRADER,
        graderConstructSlug: "lore-essay-grader",
      }),
    );

    expect(exit._tag).toBe("Failure");
  });
});

// ---------------------------------------------------------------------------
// dispatchAndResolve — full pipeline (gateway + grader + listener)
// ---------------------------------------------------------------------------

describe("dispatchAndResolve (full in-process pipeline)", () => {
  it("calls onApproved when verdict is APPROVED", async () => {
    let called: SubstrateStepVerdict | null = null as SubstrateStepVerdict | null;
    const handlers: ResolutionHandlers = {
      onApproved: (v) =>
        Effect.sync(() => {
          called = v;
        }),
      onRejected: () => Effect.void,
      onNeedsHuman: () => Effect.void,
    };

    const verdict = await Effect.runPromise(
      dispatchAndResolve({
        submission: makeSubmission(),
        rubric: RUBRIC,
        grader: APPROVED_GRADER,
        graderConstructSlug: "lore-essay-grader",
        handlers,
      }),
    );

    expect(verdict.status).toBe("APPROVED");
    expect(called).not.toBeNull();
    expect(called?.submissionId).toBe("01HW7SAMPLE");
  });

  it("calls onRejected when verdict is REJECTED", async () => {
    let called: SubstrateStepVerdict | null = null as SubstrateStepVerdict | null;
    const handlers: ResolutionHandlers = {
      onApproved: () => Effect.void,
      onRejected: (v) =>
        Effect.sync(() => {
          called = v;
        }),
      onNeedsHuman: () => Effect.void,
    };

    const verdict = await Effect.runPromise(
      dispatchAndResolve({
        submission: makeSubmission(),
        rubric: RUBRIC,
        grader: REJECTED_GRADER,
        graderConstructSlug: "lore-essay-grader",
        handlers,
      }),
    );

    expect(verdict.status).toBe("REJECTED");
    expect(called).not.toBeNull();
    expect(called?.dimensions?.specificity).toBe(0.2);
  });

  it("calls onNeedsHuman when verdict is NEEDS_HUMAN", async () => {
    let called: SubstrateStepVerdict | null = null as SubstrateStepVerdict | null;
    const NEEDS_HUMAN_GRADER = (
      input: EssayGraderInput,
    ): Effect.Effect<EssayGraderOutput> =>
      Effect.succeed({
        status: "NEEDS_HUMAN",
        confidence: 0.45,
        reasoning: "Dissonance: loreFit high but voiceMatch low. Operator adjudicate.",
        dimensions: { loreFit: 0.9, voiceMatch: 0.25, specificity: 0.7 },
        submissionId: input.submissionId,
        traceId: input.traceId,
      });
    const handlers: ResolutionHandlers = {
      onApproved: () => Effect.void,
      onRejected: () => Effect.void,
      onNeedsHuman: (v) =>
        Effect.sync(() => {
          called = v;
        }),
    };

    const verdict = await Effect.runPromise(
      dispatchAndResolve({
        submission: makeSubmission(),
        rubric: RUBRIC,
        grader: NEEDS_HUMAN_GRADER,
        graderConstructSlug: "lore-essay-grader",
        handlers,
      }),
    );

    expect(verdict.status).toBe("NEEDS_HUMAN");
    expect(called).not.toBeNull();
    expect(called?.dimensions?.voiceMatch).toBe(0.25);
  });
});
