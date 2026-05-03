/**
 * Substrate-step dispatch — Plane-3 bridging logic for substrate-graded
 * activity steps.
 *
 * In-process this cycle (2026-05-03 phase C+E). The substrate-construct
 * runtime layer (next cycle) will replace Effect.runPromise with a Kafka
 * publish + subscribe pair; the bridging shape stays identical because
 * the construct is OPENED via Effect Requirements (consumers plug in
 * their own grader). Per OSTROM hexagonal port discipline.
 *
 * What this dispatcher does:
 *   1. Validates inbound submission against the SubstrateStepSubmission
 *      Effect Schema (defense-in-depth — the gateway already validated,
 *      but the dispatcher does NOT trust untyped JSON).
 *   2. Narrows to the per-construct grader input shape (extracts the
 *      essay payload from the discriminated union, attaches the
 *      activity-step rubric authored by the operator).
 *   3. Invokes the grader via Effect — the grader is parameter-passed,
 *      so freeside-quests doesn't depend on any specific construct
 *      package. Different worlds plug in different graders.
 *   4. Broadens the per-construct output back to SubstrateStepVerdict
 *      (universal wire format) — adds gradedAt timestamp + grader slug
 *      + contract version.
 *   5. Returns the verdict for downstream resolution (DB update +
 *      Discord ping + reward dispatch).
 *
 * Plane-3 air-gap discipline: this dispatcher does NOT touch DB, Discord,
 * Kafka, or HTTP. Those are the consumer's concern — the dispatcher
 * returns the verdict, the consumer decides what to do with it.
 */

import { Effect, Schema } from "effect";

import {
  SUBSTRATE_STEP_CONTRACT_VERSION,
  SubstrateStepSubmission,
  SubstrateStepVerdict,
} from "@freeside-quests/protocol";

// ---------------------------------------------------------------------------
// Open grader contract — the substrate-construct's input/output shape
// ---------------------------------------------------------------------------

/**
 * The shape any essay-grading substrate-construct accepts at its input
 * boundary. This mirrors @loa-constructs/lore-essay-grader's
 * `LoreEssayInput` but is duplicated here so freeside-quests doesn't
 * directly depend on a specific grader package — different worlds plug
 * in different graders that conform to this shape.
 */
export interface EssayGraderInput {
  essay: string;
  rubric: {
    prompt: string;
    loreContext?: string;
    passThreshold?: number;
  };
  submissionId: string;
  traceId: string;
}

/**
 * The shape any essay-grading substrate-construct emits at its output
 * boundary. Mirrors `LoreEssayOutput` from lore-essay-grader. The
 * `dimensions` field is construct-private; consumers MUST NOT depend
 * on specific keys (per the substrate-step protocol contract).
 */
export interface EssayGraderOutput {
  status: "APPROVED" | "REJECTED" | "NEEDS_HUMAN";
  confidence: number;
  reasoning: string;
  dimensions: Record<string, number>;
  submissionId: string;
  traceId: string;
}

// ---------------------------------------------------------------------------
// Failure modes
// ---------------------------------------------------------------------------

/**
 * Surfaced when the dispatch logic detects a problem before/after the
 * grader runs (submission shape mismatch, payload-type mismatch,
 * schema decode failure). The grader's own failure modes pass through
 * via Effect's typed error channel.
 */
export class DispatchError {
  readonly _tag = "DispatchError";
  constructor(
    readonly reason: string,
    readonly cause?: unknown,
  ) {}
}

// ---------------------------------------------------------------------------
// The dispatcher
// ---------------------------------------------------------------------------

/**
 * dispatchEssayQuest — bridges a SubstrateStepSubmission through any
 * essay-grading substrate-construct and back to a SubstrateStepVerdict.
 *
 * Generic over the grader's error type (E) and Requirements (R) — Effect
 * propagates them through the dispatch's signature.
 *
 * @example
 * ```typescript
 * import { gradeLoreEssay, TestModelRunner } from "@loa-constructs/lore-essay-grader";
 *
 * const verdict = await Effect.runPromise(
 *   dispatchEssayQuest({
 *     submission,                                // SubstrateStepSubmission
 *     rubric: { prompt, loreContext, passThreshold: 0.6 },
 *     grader: gradeLoreEssay,                    // any construct with this shape
 *     graderConstructSlug: "lore-essay-grader",
 *   }).pipe(Effect.provide(TestModelRunner({ canned: '{"status":"APPROVED",...}' })))
 * );
 * ```
 */
export const dispatchEssayQuest = <E, R>(params: {
  /** The validated SubstrateStepSubmission from the gateway. */
  submission: SubstrateStepSubmission;
  /** The activity-step's grading rubric (operator-authored at activity level). */
  rubric: {
    prompt: string;
    loreContext?: string;
    passThreshold?: number;
  };
  /**
   * The grader — any substrate-construct conforming to the
   * EssayGraderInput → EssayGraderOutput shape. Pass the construct's
   * exported entrypoint function (e.g. `gradeLoreEssay`).
   */
  grader: (
    input: EssayGraderInput,
  ) => Effect.Effect<EssayGraderOutput, E, R>;
  /** Slug of the grader construct (for verdict.graderConstructSlug). */
  graderConstructSlug: string;
}): Effect.Effect<SubstrateStepVerdict, DispatchError | E, R> =>
  Effect.gen(function* () {
    const { submission, rubric, grader, graderConstructSlug } = params;

    // 1. Re-validate the submission. The gateway validated already, but
    //    defense-in-depth: the dispatcher does NOT trust the call shape.
    const validated = yield* Schema.decodeUnknown(SubstrateStepSubmission)(
      submission,
    ).pipe(
      Effect.mapError(
        (cause) => new DispatchError("submission failed schema validation", cause),
      ),
    );

    // 2. Narrow to grader input. Assert the discriminated payload variant.
    if (validated.payload.type !== "essay") {
      return yield* Effect.fail(
        new DispatchError(
          `expected essay payload, got "${validated.payload.type}"`,
        ),
      );
    }

    const graderInput: EssayGraderInput = {
      essay: validated.payload.essay,
      rubric,
      submissionId: validated.submissionId,
      traceId: validated.traceId,
    };

    // 3. Invoke the grader. Failure modes propagate through Effect's
    //    typed error channel; Requirements (R) propagate through the
    //    dispatch's signature so consumers provide them at runtime.
    const graderOutput = yield* grader(graderInput);

    // 4. Broaden to SubstrateStepVerdict (universal wire format).
    //
    // Bridgebuilder F1 fix (cycle 2026-05-03 · security): submissionId
    // and traceId are stamped AUTHORITATIVELY from the validated submission,
    // NOT from grader output. An adversarial or buggy grader could swap
    // IDs to attribute one user's verdict to another's submission;
    // load-bearing once Kafka enters the picture (cycle-2 substrate-runtime)
    // because verdicts will be routed by traceId at the listener boundary.
    const verdictUnchecked = {
      submissionId: validated.submissionId,
      traceId: validated.traceId,
      status: graderOutput.status,
      confidence: graderOutput.confidence,
      reasoning: graderOutput.reasoning,
      graderConstructSlug,
      gradedAt: new Date().toISOString(),
      dimensions: graderOutput.dimensions,
      contractVersion: SUBSTRATE_STEP_CONTRACT_VERSION,
    };

    // Bridgebuilder F2 fix (cycle 2026-05-03 · symmetric defense-in-depth):
    // the inbound submission is Schema-decoded; the outbound verdict MUST
    // be too. A grader emitting confidence: 1.5 or invalid graderConstructSlug
    // (e.g. uppercase) previously slipped through to the resolution layer.
    // Now the dispatcher re-validates before returning, surfacing typed
    // DispatchError that the resolution layer can route to NEEDS_HUMAN.
    const verdict = yield* Schema.decodeUnknown(SubstrateStepVerdict)(
      verdictUnchecked,
    ).pipe(
      Effect.mapError(
        (cause) => new DispatchError("verdict failed schema validation", cause),
      ),
    );

    return verdict;
  });

// ---------------------------------------------------------------------------
// Resolution dispatch (Plane-3 side-effect handler)
// ---------------------------------------------------------------------------

/**
 * Side-effect dispatch handles for resolving a verdict. In-process this
 * session — next cycle replaces with Kafka subscriber + DB update +
 * Discord webhook + reward trigger.
 *
 * Each handler is OPENED — consumers provide the concrete impl (DB
 * write, Discord post, reward mint). The dispatcher just routes the
 * verdict to the right handler based on status.
 */
export interface ResolutionHandlers<R = never, E = never> {
  /** Called when the verdict is APPROVED. Side-effect: badge + DB + ping. */
  onApproved: (verdict: SubstrateStepVerdict) => Effect.Effect<void, E, R>;
  /** Called when the verdict is REJECTED. Side-effect: feedback + retry hint. */
  onRejected: (verdict: SubstrateStepVerdict) => Effect.Effect<void, E, R>;
  /** Called when the verdict is NEEDS_HUMAN. Side-effect: operator queue. */
  onNeedsHuman: (verdict: SubstrateStepVerdict) => Effect.Effect<void, E, R>;
}

/**
 * resolveVerdict — routes a SubstrateStepVerdict to the appropriate
 * ResolutionHandlers handler. This is the "listener" side of the
 * gateway/listener pair (in-process this session).
 */
export const resolveVerdict = <R, E>(params: {
  verdict: SubstrateStepVerdict;
  handlers: ResolutionHandlers<R, E>;
}): Effect.Effect<void, E, R> => {
  const { verdict, handlers } = params;
  switch (verdict.status) {
    case "APPROVED":
      return handlers.onApproved(verdict);
    case "REJECTED":
      return handlers.onRejected(verdict);
    case "NEEDS_HUMAN":
      return handlers.onNeedsHuman(verdict);
    default: {
      // Exhaustiveness guard — VerdictStatus is a closed union, so this is unreachable.
      const _exhaustive: never = verdict.status;
      throw new Error(`unreachable: unknown verdict status ${_exhaustive}`);
    }
  }
};

/**
 * dispatchAndResolve — convenience composition of dispatchEssayQuest +
 * resolveVerdict. The full pipeline in one call.
 *
 * Use this for the in-process smoke path; production pipelines split
 * dispatch (publishes to topic) and resolve (subscribes to topic) so
 * they can scale + isolate independently.
 */
export const dispatchAndResolve = <DispatchE, DispatchR, ResolveE, ResolveR>(params: {
  submission: SubstrateStepSubmission;
  rubric: {
    prompt: string;
    loreContext?: string;
    passThreshold?: number;
  };
  grader: (
    input: EssayGraderInput,
  ) => Effect.Effect<EssayGraderOutput, DispatchE, DispatchR>;
  graderConstructSlug: string;
  handlers: ResolutionHandlers<ResolveR, ResolveE>;
}): Effect.Effect<
  SubstrateStepVerdict,
  DispatchError | DispatchE | ResolveE,
  DispatchR | ResolveR
> =>
  Effect.gen(function* () {
    const verdict = yield* dispatchEssayQuest({
      submission: params.submission,
      rubric: params.rubric,
      grader: params.grader,
      graderConstructSlug: params.graderConstructSlug,
    });

    yield* resolveVerdict({ verdict, handlers: params.handlers });

    return verdict;
  });
