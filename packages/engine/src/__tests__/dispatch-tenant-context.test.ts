/**
 * dispatch-tenant-context.test.ts — tenantId plumbing + AC-B1.11.1
 * pre-invocation tenant-boundary assertion (cycle-B sprint-1 · B-1.11).
 *
 * Validates:
 *   - dispatchEssayQuest plumbs tenantId through to EssayGraderInput
 *   - tenantId omitted → grader receives undefined (backwards compat)
 *   - AC-B1.11.1 · tenantId + expectedTenant match → grader runs
 *   - AC-B1.11.1 · tenantId + expectedTenant mismatch → DispatchError
 *     before grader runs (pre-invocation assertion)
 *   - dispatchAndResolve passes through both fields
 */

import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";

import { dispatchEssayQuest, dispatchAndResolve, DispatchError } from "../dispatch.js";
import type {
  EssayGraderInput,
  EssayGraderOutput,
  ResolutionHandlers,
} from "../dispatch.js";
import type { SubstrateStepSubmission, SubstrateStepVerdict } from "@0xhoneyjar/quests-protocol";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeSubmission = (): SubstrateStepSubmission => ({
  submissionId: "01HW7TENANT",
  traceId: "trace-01HW7TENANT",
  activityId: "act-tenant-test",
  activitySlug: "tenant-test",
  stepId: "tenant-step",
  walletAddress: `0x${"b".repeat(40)}`,
  payload: {
    type: "essay",
    essay: "the steppe holds the wind that does not return",
  },
  submittedAt: "2026-05-05T18:00:00.000Z",
  contractVersion: "1.0.0",
});

const RUBRIC = {
  prompt: "Explain the steppe in 1-2 sentences.",
  passThreshold: 0.5,
};

interface CallCapture {
  inputs: EssayGraderInput[];
}

const buildCapturingGrader = (
  capture: CallCapture,
): ((input: EssayGraderInput) => Effect.Effect<EssayGraderOutput>) =>
  (input) => {
    capture.inputs.push(input);
    return Effect.succeed({
      status: "APPROVED",
      confidence: 0.85,
      reasoning: "captured",
      dimensions: { loreFit: 0.8 },
      submissionId: input.submissionId,
      traceId: input.traceId,
    });
  };

// ---------------------------------------------------------------------------
// dispatchEssayQuest · tenantId plumbing
// ---------------------------------------------------------------------------

describe("cycle-B · dispatchEssayQuest · tenantId plumbing (B-1.11)", () => {
  it("plumbs tenantId from caller into EssayGraderInput", async () => {
    const capture: CallCapture = { inputs: [] };
    const grader = buildCapturingGrader(capture);
    await Effect.runPromise(
      dispatchEssayQuest({
        submission: makeSubmission(),
        rubric: RUBRIC,
        grader,
        graderConstructSlug: "test-grader",
        tenantId: "mibera",
      }),
    );
    expect(capture.inputs).toHaveLength(1);
    expect(capture.inputs[0]?.tenantId).toBe("mibera");
  });

  it("plumbs undefined tenantId for backwards compat (pre-cycle-B paths)", async () => {
    const capture: CallCapture = { inputs: [] };
    const grader = buildCapturingGrader(capture);
    await Effect.runPromise(
      dispatchEssayQuest({
        submission: makeSubmission(),
        rubric: RUBRIC,
        grader,
        graderConstructSlug: "test-grader",
      }),
    );
    expect(capture.inputs[0]?.tenantId).toBeUndefined();
  });

  it("plumbs tenantId from cubquest correctly (no per-tenant branch)", async () => {
    const capture: CallCapture = { inputs: [] };
    await Effect.runPromise(
      dispatchEssayQuest({
        submission: makeSubmission(),
        rubric: RUBRIC,
        grader: buildCapturingGrader(capture),
        graderConstructSlug: "test-grader",
        tenantId: "cubquest",
      }),
    );
    expect(capture.inputs[0]?.tenantId).toBe("cubquest");
  });
});

// ---------------------------------------------------------------------------
// AC-B1.11.1 · pre-invocation tenant-boundary assertion
// ---------------------------------------------------------------------------

describe("cycle-B · dispatchEssayQuest · AC-B1.11.1 tenant boundary assertion", () => {
  it("matching tenantId + expectedTenant → grader runs (positive control)", async () => {
    const capture: CallCapture = { inputs: [] };
    const verdict = await Effect.runPromise(
      dispatchEssayQuest({
        submission: makeSubmission(),
        rubric: RUBRIC,
        grader: buildCapturingGrader(capture),
        graderConstructSlug: "test-grader",
        tenantId: "mibera",
        expectedTenant: "mibera",
      }),
    );
    expect(capture.inputs).toHaveLength(1);
    expect(verdict.status).toBe("APPROVED");
  });

  it("mismatched tenantId vs expectedTenant → DispatchError BEFORE grader runs", async () => {
    const capture: CallCapture = { inputs: [] };
    const exit = await Effect.runPromiseExit(
      dispatchEssayQuest({
        submission: makeSubmission(),
        rubric: RUBRIC,
        grader: buildCapturingGrader(capture),
        graderConstructSlug: "test-grader",
        tenantId: "mibera",
        expectedTenant: "cubquest",
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const causeStr = JSON.stringify(exit.cause, (_k, v) =>
        v instanceof Error ? { name: v.name, message: v.message } : v,
      );
      expect(causeStr).toContain("DispatchError");
      expect(causeStr).toContain("tenant_assertion_failed");
      expect(causeStr).toContain("mibera");
      expect(causeStr).toContain("cubquest");
    }
    // Critical · the grader was NEVER called (assertion fired pre-invocation)
    expect(capture.inputs).toHaveLength(0);
  });

  it("only tenantId provided (no expectedTenant) → no assertion · grader runs", async () => {
    // Backwards-compat path · partial wiring during operator rollout
    const capture: CallCapture = { inputs: [] };
    await Effect.runPromise(
      dispatchEssayQuest({
        submission: makeSubmission(),
        rubric: RUBRIC,
        grader: buildCapturingGrader(capture),
        graderConstructSlug: "test-grader",
        tenantId: "mibera",
        // expectedTenant intentionally omitted
      }),
    );
    expect(capture.inputs).toHaveLength(1);
    expect(capture.inputs[0]?.tenantId).toBe("mibera");
  });

  it("only expectedTenant (no tenantId) → no assertion · grader runs (anon path)", async () => {
    // Anon-fallback path · world expects mibera but submission has no JWT
    const capture: CallCapture = { inputs: [] };
    await Effect.runPromise(
      dispatchEssayQuest({
        submission: makeSubmission(),
        rubric: RUBRIC,
        grader: buildCapturingGrader(capture),
        graderConstructSlug: "test-grader",
        expectedTenant: "mibera",
        // tenantId omitted (anon)
      }),
    );
    expect(capture.inputs).toHaveLength(1);
    expect(capture.inputs[0]?.tenantId).toBeUndefined();
  });

  it("reverse direction: cubquest jwt against mibera world also rejects", async () => {
    const capture: CallCapture = { inputs: [] };
    const exit = await Effect.runPromiseExit(
      dispatchEssayQuest({
        submission: makeSubmission(),
        rubric: RUBRIC,
        grader: buildCapturingGrader(capture),
        graderConstructSlug: "test-grader",
        tenantId: "cubquest",
        expectedTenant: "mibera",
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(capture.inputs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// dispatchAndResolve · pass-through
// ---------------------------------------------------------------------------

describe("cycle-B · dispatchAndResolve · tenantId pass-through (B-1.11)", () => {
  it("plumbs tenantId + assertion through composed pipeline", async () => {
    const capture: CallCapture = { inputs: [] };
    const handlerCalls = { approved: 0, rejected: 0, needsHuman: 0 };
    const handlers: ResolutionHandlers = {
      onApproved: () =>
        Effect.sync(() => {
          handlerCalls.approved++;
        }),
      onRejected: () =>
        Effect.sync(() => {
          handlerCalls.rejected++;
        }),
      onNeedsHuman: () =>
        Effect.sync(() => {
          handlerCalls.needsHuman++;
        }),
    };

    await Effect.runPromise(
      dispatchAndResolve({
        submission: makeSubmission(),
        rubric: RUBRIC,
        grader: buildCapturingGrader(capture),
        graderConstructSlug: "test-grader",
        handlers,
        tenantId: "mibera",
        expectedTenant: "mibera",
      }),
    );
    expect(capture.inputs[0]?.tenantId).toBe("mibera");
    expect(handlerCalls.approved).toBe(1);
  });

  it("dispatchAndResolve · mismatched tenant → DispatchError + handlers NOT called", async () => {
    const capture: CallCapture = { inputs: [] };
    const handlerCalls = { approved: 0, rejected: 0, needsHuman: 0 };
    const handlers: ResolutionHandlers = {
      onApproved: () =>
        Effect.sync(() => {
          handlerCalls.approved++;
        }),
      onRejected: () =>
        Effect.sync(() => {
          handlerCalls.rejected++;
        }),
      onNeedsHuman: () =>
        Effect.sync(() => {
          handlerCalls.needsHuman++;
        }),
    };

    const exit = await Effect.runPromiseExit(
      dispatchAndResolve({
        submission: makeSubmission(),
        rubric: RUBRIC,
        grader: buildCapturingGrader(capture),
        graderConstructSlug: "test-grader",
        handlers,
        tenantId: "mibera",
        expectedTenant: "cubquest",
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    // Neither grader nor handlers fired
    expect(capture.inputs).toHaveLength(0);
    expect(handlerCalls.approved).toBe(0);
    expect(handlerCalls.rejected).toBe(0);
    expect(handlerCalls.needsHuman).toBe(0);
  });
});
