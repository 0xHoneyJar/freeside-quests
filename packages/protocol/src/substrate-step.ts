/**
 * Substrate-Step Protocol — wire-format contract for substrate-graded
 * activity steps in cubquests-interface (and any future world that imports
 * `@freeside-quests/protocol`).
 *
 * Companion to `cubquests-interface/types/activities.ts`'s
 * `OffchainStepConfig`. Today that config supports verificationType
 * `"manual" | "api" | "social"`. This protocol introduces the substrate-
 * graded counterpart: a step whose verdict comes from a Loa construct
 * invoked through Hounfour's CompletionRequest envelope. Operator authors
 * lore + grading instructions; the construct enforces them.
 *
 * Two schemas land in this file (BARTH cycle 1 · 2026-05-03):
 *   - SubstrateStepSubmission — what the freeside-quests gateway publishes
 *     to the substrate after validating an inbound user submission.
 *   - SubstrateStepVerdict — what the construct yields back, validated by
 *     the freeside-quests resolution listener before any downstream side
 *     effect (DB update, badge issuance, Discord ping).
 *
 * Three boundaries validate against these schemas:
 *   1. freeside-quests/apps/api gateway (Discord/web) — validates inbound
 *      submission against SubstrateStepSubmission, wraps in a Hounfour
 *      CompletionRequest, publishes to Kafka.
 *   2. construct (loa-constructs/packs/lore-essay-grader/, etc.) — validates
 *      its narrower per-construct input shape; emits SubstrateStepVerdict
 *      back into the result topic.
 *   3. freeside-quests/apps/worker resolution listener — validates inbound
 *      Kafka payload against SubstrateStepVerdict before dispatch.
 *
 * Anything broader than the activity-step boundary (quest defs, badges,
 * raffles, completion events) lives in sibling files of this package per
 * the freeside-quests/packages/protocol/README planned-contents table.
 */

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Submission payload — discriminated union
// ---------------------------------------------------------------------------

/**
 * Free-form text answer (instance-1 — the lore-essay shape).
 * Bounded length: substrate constructs grade prose, not novels. Rate-limit
 * + cost protection at the gateway, not at the schema.
 */
const EssayPayload = Schema.Struct({
  type: Schema.Literal("essay"),
  essay: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(10000)),
});

/**
 * URL pointing at the user's proof artifact (image, gallery post, doc).
 * The construct fetches + grades the bytes; the gateway only validates
 * the URL is well-formed, not its contents.
 */
const UrlPayload = Schema.Struct({
  type: Schema.Literal("url"),
  url: Schema.String.pipe(Schema.minLength(1)),
});

/**
 * Structured payload for constructs that need richer input (e.g., a
 * multi-part submission with metadata). Inner shape is construct-defined;
 * narrower schema lives in the construct pack.
 */
const StructuredPayload = Schema.Struct({
  type: Schema.Literal("structured"),
  data: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

/**
 * Discriminated union of all supported submission payload shapes. Adding
 * a new variant is an additive minor bump under the contract-version
 * governance imported from loa-constructs.
 */
export const SubstrateStepPayload = Schema.Union(
  EssayPayload,
  UrlPayload,
  StructuredPayload,
);

export type SubstrateStepPayload = Schema.Schema.Type<typeof SubstrateStepPayload>;

// ---------------------------------------------------------------------------
// SubstrateStepSubmission — gateway → kafka → construct
// ---------------------------------------------------------------------------

/**
 * The over-the-wire submission shape that flows from the freeside-quests
 * gateway through Kafka to the substrate construct. Validated at every
 * boundary; constructs DO NOT trust untyped JSON.parse output.
 *
 * `traceId` correlates the submission with the eventual verdict and with
 * the underlying Hounfour CompletionRequest (which carries its own
 * request_id). The freeside-quests resolution listener subscribes by
 * `traceId` so a single submission round-trips cleanly.
 *
 * `walletAddress` is lowercased canonical hex per
 * `cubquests-interface/lib/activities/offchain-verifiers.ts` line ≈ 295
 * (`address: userAddress.toLowerCase()`). Casing is enforced at the
 * gateway, not at the construct.
 */
export const SubstrateStepSubmission = Schema.Struct({
  /** UUID minted by the gateway when the user submits. */
  submissionId: Schema.String.pipe(Schema.minLength(1)),
  /** Correlation ID — matches the eventual SubstrateStepVerdict.traceId. */
  traceId: Schema.String.pipe(Schema.minLength(1)),
  /** Activity primary key (uuid). Mirrors cubquests-interface activities.id. */
  activityId: Schema.String.pipe(Schema.minLength(1)),
  /** Activity slug (kebab-case, human-readable). Mirrors activities.slug. */
  activitySlug: Schema.String.pipe(Schema.minLength(1)),
  /** Step ID within the activity. Mirrors ActivityStep.id. */
  stepId: Schema.String.pipe(Schema.minLength(1)),
  /** EVM address (lowercased 0x + 40 hex chars). Per cubquests-interface canon. */
  walletAddress: Schema.String.pipe(Schema.pattern(/^0x[a-f0-9]{40}$/)),
  /** Discriminated payload — varies by activity step's authored shape. */
  payload: SubstrateStepPayload,
  /** ISO datetime — when the user submitted (gateway clock, not construct clock). */
  submittedAt: Schema.String,
  /** Semver — protocol contract version this submission targets. */
  contractVersion: Schema.String.pipe(Schema.pattern(/^\d+\.\d+\.\d+$/)),
});

export type SubstrateStepSubmission = Schema.Schema.Type<typeof SubstrateStepSubmission>;

// ---------------------------------------------------------------------------
// SubstrateStepVerdict — construct → kafka → resolution listener
// ---------------------------------------------------------------------------

/**
 * Verdict status ladder. APPROVED + REJECTED are terminal (the resolution
 * listener will dispatch reward/feedback). NEEDS_HUMAN routes the submission
 * to the operator queue for manual judgment — surfaces ambiguous cases the
 * construct could not adjudicate confidently (suspected adversarial input,
 * off-rubric edge case, model uncertainty).
 */
export const VerdictStatus = Schema.Literal("APPROVED", "REJECTED", "NEEDS_HUMAN");

export type VerdictStatus = Schema.Schema.Type<typeof VerdictStatus>;

/**
 * The over-the-wire verdict a substrate construct returns.
 *
 * `confidence` is the construct's self-reported judgment strength on
 * [0, 1]. The activity-config-side `passThreshold` (authored by the
 * activity creator, not modeled in this schema) determines whether
 * APPROVED+confidence is accepted or routed to NEEDS_HUMAN downstream.
 *
 * `reasoning` MUST be human-readable when status is REJECTED — the user
 * sees this feedback in Discord and uses it to retry. ALEXANDER craft check:
 * an empty or generic reasoning string defeats the substrate's value-add.
 *
 * `dimensions` is an optional construct-specific evaluation breakdown,
 * e.g. `{ lore_fit: 0.82, voice_match: 0.54, specificity: 0.71 }` for the
 * lore-essay-grader. Each dimension is on [0, 1]. Consumers MUST NOT depend
 * on specific keys — they are construct-private and may evolve.
 */
export const SubstrateStepVerdict = Schema.Struct({
  /** Mirrors SubstrateStepSubmission.submissionId. */
  submissionId: Schema.String.pipe(Schema.minLength(1)),
  /** Mirrors SubstrateStepSubmission.traceId. */
  traceId: Schema.String.pipe(Schema.minLength(1)),
  /** Verdict outcome. */
  status: VerdictStatus,
  /** Construct's self-reported confidence on [0, 1]. */
  confidence: Schema.Number.pipe(Schema.between(0, 1)),
  /** Human-readable reasoning surfaced to the user on REJECTED. */
  reasoning: Schema.String.pipe(Schema.minLength(1)),
  /** Construct that emitted this verdict (kebab-case slug). */
  graderConstructSlug: Schema.String.pipe(Schema.pattern(/^[a-z][a-z0-9-]*$/)),
  /** Optional model identifier — for audit trail. Not user-visible. */
  graderModelId: Schema.optional(Schema.String),
  /** ISO datetime — when the construct emitted the verdict. */
  gradedAt: Schema.String,
  /** Optional construct-specific evaluation dimensions on [0, 1]. */
  dimensions: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Number.pipe(Schema.between(0, 1)),
    }),
  ),
  /** Semver — protocol contract version this verdict targets. */
  contractVersion: Schema.String.pipe(Schema.pattern(/^\d+\.\d+\.\d+$/)),
});

export type SubstrateStepVerdict = Schema.Schema.Type<typeof SubstrateStepVerdict>;

// ---------------------------------------------------------------------------
// Contract version
// ---------------------------------------------------------------------------

/**
 * Substrate-step protocol version. Cycle-1 of freeside-quests substrate
 * integration (2026-05-03). Bumps follow loa-constructs/.claude/schemas/
 * VERSIONING.md governance: enum-locked, additive-only minors, major
 * bumps require new file + migration plan + stable `$id`.
 */
export const SUBSTRATE_STEP_CONTRACT_VERSION = "1.0.0" as const;
