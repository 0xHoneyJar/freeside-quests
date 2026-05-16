import { Schema } from "effect";

import { EventId } from "../branded/EventId.js";
import { PartnerId } from "../branded/PartnerId.js";
import { SnapshotId } from "../branded/SnapshotId.js";
import { StepId } from "../branded/StepId.js";
import { RFC3339Date } from "../encoding/date.js";

/**
 * VerificationMethod — sealed union of 6 verification strategies (FR-3 ·
 * CL-Step-1..3 · per PRD §FR-3).
 *
 * Each variant carries only the substrate-meaningful fields. World-specific
 * payloads (e.g. curator note text · partner request body) are NOT part of
 * the sealed union — those live in the CompletionEvent body, hash-bound to
 * the step via {@link StepCompletion.event_id}.
 *
 * Variants:
 *   - ManualCurator   → human-graded · curator_id slug
 *   - SignedMemoTx    → ed25519 / EIP-191 signed memo · chain identifier
 *   - MerkleProof     → cubquests-style merkle-snapshot proof · snapshot_id
 *   - WebhookHmac     → 3rd-party HMAC webhook · source slug · env-var name for secret
 *   - PartnerApi      → registered partner round-trip · partner_id + endpoint
 *   - OnChainEvent    → contract event watcher · vm discriminator (D12 resolved)
 *
 * In Effect 3.x the `Schema.TaggedEnum` PRD code sample becomes
 * `Schema.Union(Schema.TaggedStruct("Tag", {...}), ...)` — see ActivityKind.ts
 * for the same pattern. Discriminator: `_tag`.
 */
export const VerificationManualCurator = Schema.TaggedStruct("ManualCurator", {
  curator_id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
});

export const VerificationSignedMemoTx = Schema.TaggedStruct("SignedMemoTx", {
  chain: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64)),
});

export const VerificationMerkleProof = Schema.TaggedStruct("MerkleProof", {
  snapshot_id: SnapshotId,
});

export const VerificationWebhookHmac = Schema.TaggedStruct("WebhookHmac", {
  source: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  /**
   * Name of the env var (NOT the secret itself) holding the HMAC key.
   * Restricts to uppercase + digits + underscore (POSIX env-var grammar).
   */
  secret_env: Schema.String.pipe(Schema.pattern(/^[A-Z][A-Z0-9_]{0,127}$/)),
});

export const VerificationPartnerApi = Schema.TaggedStruct("PartnerApi", {
  partner_id: PartnerId,
  endpoint: Schema.String.pipe(
    Schema.pattern(/^https?:\/\/[^\s]+$/),
    Schema.minLength(1),
    Schema.maxLength(512),
  ),
});

/**
 * Virtual-machine discriminator (D12 RESOLVED).
 *
 * `evm`   — Ethereum / OP-stack / EVM-compatible chains
 * `svm`   — Solana / Eclipse / SVM-compatible
 * `move`  — Aptos / Sui / Move VM
 * `other` — escape hatch · the world is responsible for own decoder
 */
export const OnChainVmKind = Schema.Literal("evm", "svm", "move", "other");

export type OnChainVmKind = Schema.Schema.Type<typeof OnChainVmKind>;

export const VerificationOnChainEvent = Schema.TaggedStruct("OnChainEvent", {
  contract: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  event: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  vm: OnChainVmKind,
});

/**
 * VerificationMethod — the sealed union (CL-Step-1).
 *
 * Adding a new method requires a /architect cycle (CL-Step-1). Each method
 * MUST be expressible inside CompletionEvent without leaking world-specific
 * payload shapes into the substrate.
 */
export const VerificationMethod = Schema.Union(
  VerificationManualCurator,
  VerificationSignedMemoTx,
  VerificationMerkleProof,
  VerificationWebhookHmac,
  VerificationPartnerApi,
  VerificationOnChainEvent,
);

export type VerificationMethod = Schema.Schema.Type<typeof VerificationMethod>;

/**
 * ActivityStep (FR-3 · CL-Step-1..3 · per SDD §3.1).
 *
 * Replaces the cycle-2 minimal stub with the full schema:
 *   - step_id     → branded StepId (FR-12-ish)
 *   - description → free text · world skins this · max 1024 chars
 *   - verification → sealed VerificationMethod (CL-Step-1)
 *   - required    → false = optional step (skippable on completion)
 *   - order       → sequencing within steps[] · stable canonical sort key (§5.6)
 */
export const ActivityStep = Schema.Struct({
  step_id: StepId,
  description: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1024)),
  verification: VerificationMethod,
  required: Schema.Boolean,
  order: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export type ActivityStep = Schema.Schema.Type<typeof ActivityStep>;

/**
 * StepCompletion — the recorded result of one step's verification.
 *
 * Referenced by preimage schemas (§5.6) and ProgressRecord (§3.2). Sorted
 * by `(order, step_id)` for canonical ordering — see SDD §5.6 golden
 * tie-break rule (equal orders → step_id lexicographic).
 */
export const StepCompletion = Schema.Struct({
  step_id: StepId,
  order: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  completed_at: RFC3339Date,
  event_id: EventId,
});

export type StepCompletion = Schema.Schema.Type<typeof StepCompletion>;
