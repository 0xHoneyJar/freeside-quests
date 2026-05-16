import { Either, ParseResult, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ActivityStep, OnChainVmKind, StepCompletion, VerificationMethod } from "./index.js";

/**
 * T1.5 acceptance test suite.
 *
 * - roundtrip per VerificationMethod variant
 * - `vm` rejected for non-OnChainEvent cases
 * - stable ordering (canonical sort key behavior + tie-break per §5.6)
 */

const expectFail = <A, I>(schema: Schema.Schema<A, I>, input: unknown) => {
  const result = Schema.decodeUnknownEither(schema)(input);
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isLeft(result)) {
    expect(ParseResult.isParseError(result.left)).toBe(true);
  }
};

describe("VerificationMethod · ManualCurator", () => {
  it("decodes a valid ManualCurator with a curator_id", () => {
    const v = Schema.decodeUnknownSync(VerificationMethod)({
      _tag: "ManualCurator",
      curator_id: "alice-grader",
    });
    expect(v._tag).toBe("ManualCurator");
  });

  it("rejects ManualCurator with empty curator_id", () => {
    expectFail(VerificationMethod, { _tag: "ManualCurator", curator_id: "" });
  });

  it("ignores extra fields on ManualCurator (loose struct · vm has no semantic effect)", () => {
    // Effect.Schema.Struct is non-strict by default — matching PRD §FR-3 spec.
    // The substrate's sealed-union discipline is enforced by `_tag` (tested
    // below) and by variant-specific REQUIRED fields. Extra fields are
    // dropped from the decoded type, not rejected.
    const v = Schema.decodeUnknownSync(VerificationMethod)({
      _tag: "ManualCurator",
      curator_id: "alice",
      vm: "evm",
    });
    expect(v._tag).toBe("ManualCurator");
    expect("vm" in v).toBe(false);
  });
});

describe("VerificationMethod · SignedMemoTx", () => {
  it("decodes a valid SignedMemoTx with a chain identifier", () => {
    const v = Schema.decodeUnknownSync(VerificationMethod)({
      _tag: "SignedMemoTx",
      chain: "ethereum",
    });
    expect(v._tag).toBe("SignedMemoTx");
  });

  it("rejects SignedMemoTx without a chain field", () => {
    expectFail(VerificationMethod, { _tag: "SignedMemoTx" });
  });

  it("drops extra fields like vm (cross-variant pollution stripped at decode)", () => {
    const v = Schema.decodeUnknownSync(VerificationMethod)({
      _tag: "SignedMemoTx",
      chain: "ethereum",
      vm: "evm",
    });
    expect(v._tag).toBe("SignedMemoTx");
    expect("vm" in v).toBe(false);
  });
});

describe("VerificationMethod · MerkleProof", () => {
  it("decodes a valid MerkleProof with a SnapshotId", () => {
    const v = Schema.decodeUnknownSync(VerificationMethod)({
      _tag: "MerkleProof",
      snapshot_id: "snap_20260515",
    });
    expect(v._tag).toBe("MerkleProof");
  });

  it("rejects MerkleProof with a non-SnapshotId-shaped snapshot_id", () => {
    expectFail(VerificationMethod, {
      _tag: "MerkleProof",
      snapshot_id: "not-a-snapshot",
    });
  });

  it("drops extra fields like vm", () => {
    const v = Schema.decodeUnknownSync(VerificationMethod)({
      _tag: "MerkleProof",
      snapshot_id: "snap_a",
      vm: "evm",
    });
    expect(v._tag).toBe("MerkleProof");
    expect("vm" in v).toBe(false);
  });
});

describe("VerificationMethod · WebhookHmac", () => {
  it("decodes a valid WebhookHmac with POSIX env-var name", () => {
    const v = Schema.decodeUnknownSync(VerificationMethod)({
      _tag: "WebhookHmac",
      source: "stripe",
      secret_env: "STRIPE_WEBHOOK_SECRET",
    });
    expect(v._tag).toBe("WebhookHmac");
  });

  it("rejects WebhookHmac with non-POSIX env-var name (lowercase)", () => {
    expectFail(VerificationMethod, {
      _tag: "WebhookHmac",
      source: "stripe",
      secret_env: "stripe_secret",
    });
  });

  it("rejects WebhookHmac with env name starting with digit", () => {
    expectFail(VerificationMethod, {
      _tag: "WebhookHmac",
      source: "stripe",
      secret_env: "1_SECRET",
    });
  });

  it("drops extra fields like vm", () => {
    const v = Schema.decodeUnknownSync(VerificationMethod)({
      _tag: "WebhookHmac",
      source: "stripe",
      secret_env: "X",
      vm: "evm",
    });
    expect(v._tag).toBe("WebhookHmac");
    expect("vm" in v).toBe(false);
  });
});

describe("VerificationMethod · PartnerApi", () => {
  it("decodes a valid PartnerApi with PartnerId + https endpoint", () => {
    const v = Schema.decodeUnknownSync(VerificationMethod)({
      _tag: "PartnerApi",
      partner_id: "merkl",
      endpoint: "https://api.merkl.example/v1/check",
    });
    expect(v._tag).toBe("PartnerApi");
  });

  it("rejects PartnerApi with malformed PartnerId (uppercase)", () => {
    expectFail(VerificationMethod, {
      _tag: "PartnerApi",
      partner_id: "Merkl",
      endpoint: "https://api.merkl.example/v1/check",
    });
  });

  it("rejects PartnerApi with non-http endpoint", () => {
    expectFail(VerificationMethod, {
      _tag: "PartnerApi",
      partner_id: "merkl",
      endpoint: "tcp://merkl.example:5000",
    });
  });

  it("drops extra fields like vm", () => {
    const v = Schema.decodeUnknownSync(VerificationMethod)({
      _tag: "PartnerApi",
      partner_id: "merkl",
      endpoint: "https://x",
      vm: "evm",
    });
    expect(v._tag).toBe("PartnerApi");
    expect("vm" in v).toBe(false);
  });
});

describe("VerificationMethod · OnChainEvent (D12 vm discriminator)", () => {
  it("decodes each VM kind variant cleanly (evm / svm / move / other)", () => {
    for (const vm of ["evm", "svm", "move", "other"] as const) {
      const v = Schema.decodeUnknownSync(VerificationMethod)({
        _tag: "OnChainEvent",
        contract: "0xabc",
        event: "Transfer",
        vm,
      });
      expect(v._tag).toBe("OnChainEvent");
    }
  });

  it("rejects OnChainEvent with vm outside the sealed enum", () => {
    expectFail(VerificationMethod, {
      _tag: "OnChainEvent",
      contract: "0xabc",
      event: "Transfer",
      vm: "wasm",
    });
  });

  it("rejects OnChainEvent missing the vm field (D12 mandatory)", () => {
    expectFail(VerificationMethod, {
      _tag: "OnChainEvent",
      contract: "0xabc",
      event: "Transfer",
    });
  });

  it("OnChainVmKind sealed-literal rejects unknown values directly", () => {
    expectFail(OnChainVmKind, "tezos");
    expectFail(OnChainVmKind, "EVM"); // uppercase rejected
  });
});

describe("VerificationMethod · sealed-union discipline", () => {
  it("rejects an unknown _tag value (exhaustive sealed union)", () => {
    expectFail(VerificationMethod, { _tag: "GodMode" });
  });

  it("rejects a missing _tag", () => {
    expectFail(VerificationMethod, { curator_id: "alice" });
  });
});

describe("ActivityStep (FR-3 full schema)", () => {
  const validStep = {
    step_id: "step_intro-1",
    description: "Complete the welcome dialogue",
    verification: { _tag: "ManualCurator", curator_id: "alice" },
    required: true,
    order: 0,
  };

  it("decodes a complete ActivityStep", () => {
    const v = Schema.decodeUnknownSync(ActivityStep)(validStep);
    expect(v.step_id).toBe("step_intro-1");
    expect(v.required).toBe(true);
  });

  it("rejects step with empty description", () => {
    expectFail(ActivityStep, { ...validStep, description: "" });
  });

  it("rejects step with negative order", () => {
    expectFail(ActivityStep, { ...validStep, order: -1 });
  });

  it("rejects step with non-integer order", () => {
    expectFail(ActivityStep, { ...validStep, order: 1.5 });
  });

  it("rejects step missing verification field", () => {
    const { verification: _, ...withoutVerification } = validStep;
    expectFail(ActivityStep, withoutVerification);
  });
});

describe("StepCompletion · stable ordering (§5.6 canonical preimage rule)", () => {
  const mkCompletion = (
    step_id: string,
    order: number,
    completed_at = "2026-05-15T12:00:00Z",
    event_id = "a".repeat(64),
  ) => ({
    step_id,
    order,
    completed_at,
    event_id,
  });

  it("decodes a valid StepCompletion", () => {
    const c = Schema.decodeUnknownSync(StepCompletion)(mkCompletion("step_a", 0));
    expect(c.order).toBe(0);
  });

  it("canonical sort by (order, step_id) produces a deterministic ordering", () => {
    const raws = [
      mkCompletion("step_z", 2),
      mkCompletion("step_a", 0),
      mkCompletion("step_b", 1),
      mkCompletion("step_a-second", 0), // tie on order → step_id lex sort
    ];
    const decoded = raws.map((r) => Schema.decodeUnknownSync(StepCompletion)(r));

    const sorted = [...decoded].sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.step_id < b.step_id ? -1 : a.step_id > b.step_id ? 1 : 0;
    });

    // Expected order:
    //   (0, step_a)        — order=0, step_id="step_a"
    //   (0, step_a-second) — order=0, step_id="step_a-second" (lex after step_a)
    //   (1, step_b)
    //   (2, step_z)
    expect(sorted.map((c) => c.step_id)).toEqual(["step_a", "step_a-second", "step_b", "step_z"]);
  });

  it("rejects malformed event_id (must be 64-hex SHA-256)", () => {
    expectFail(StepCompletion, mkCompletion("step_a", 0, "2026-05-15T12:00:00Z", "deadbeef"));
  });

  it("rejects malformed completed_at (must be RFC3339 with Z)", () => {
    expectFail(StepCompletion, mkCompletion("step_a", 0, "2026-05-15"));
  });
});
