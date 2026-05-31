/**
 * BadgeIssuancePort static-URI adapter test (VB.2).
 *
 * Mirrors the BadgeIssuancePortNullLayer coverage in
 * `../../__tests__/auth-modes.test.ts` — same Quest / Verdict / Player
 * fixtures, same `Effect.provide(Layer)` + `Effect.runPromise` idiom — but
 * proves the STATIC Layer resolves a real `BadgeArtifact` for a known
 * `badge_spec.family_id` (the load-bearing payoff) while preserving the
 * `null` no-artifact path for unknown families.
 *
 * VB.2 · 2026-05-31 · verify-badge slice.
 */

import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import {
  type Quest,
  type QuestVerdict,
  type PlayerIdentity,
  QuestId,
  NpcId,
  BadgeFamilyId,
  WorldSlug,
  BadgeArtifact,
} from "@0xhoneyjar/quests-protocol";

import {
  BadgeIssuancePort,
  BADGE_ISSUANCE_PORT_TAG_IDENTITY,
} from "../index.js";
import {
  BadgeIssuancePortStaticLayer,
  STATIC_BADGE_REGISTRY,
  resolveStaticBadge,
} from "../static-uri.js";

// ---------------------------------------------------------------------------
// Fixtures (mirrors auth-modes.test.ts)
// ---------------------------------------------------------------------------

const verifiedPlayer: PlayerIdentity = {
  type: "verified",
  wallet: Schema.decodeUnknownSync(
    Schema.String.pipe(
      Schema.brand("PlayerWallet"),
      Schema.pattern(/^0x[a-f0-9]{40}$/),
    ),
  )("0xabcdef0123456789abcdef0123456789abcdef01"),
  discord_id: Schema.decodeUnknownSync(
    Schema.String.pipe(Schema.brand("DiscordId"), Schema.pattern(/^\d{17,20}$/)),
  )("987654321098765432"),
};

/** A quest whose badge family IS in the static registry ("verify"). */
const verifyQuest: Quest = {
  quest_id: Schema.decodeUnknownSync(QuestId)("verify-quest-001"),
  npc_pointer: Schema.decodeUnknownSync(NpcId)("verify-npc"),
  world_slug: Schema.decodeUnknownSync(WorldSlug)("stub-world"),
  title: "Verify quest",
  prompt: "verify prompt — static-badge slice, no curator content",
  rubric_pointer: { type: "url", url: "https://example.invalid/rubric" },
  badge_spec: {
    family_id: Schema.decodeUnknownSync(BadgeFamilyId)("verify"),
    display_name: "Verify Badge",
    prompt_seed: "static verify badge prompt seed",
  },
  published_at: "2026-05-31T11:59:00.000Z",
  step_count: 1 as const,
  contract_version: "1.0.0",
};

/** A quest whose badge family is NOT in the static registry. */
const unknownQuest: Quest = {
  ...verifyQuest,
  quest_id: Schema.decodeUnknownSync(QuestId)("unknown-quest-001"),
  badge_spec: {
    ...verifyQuest.badge_spec,
    family_id: Schema.decodeUnknownSync(BadgeFamilyId)("not-a-mapped-family"),
  },
};

const verdictApproved: QuestVerdict = {
  submission_id: "sub-vb2-001",
  trace_id: "trace-vb2-001",
  status: "APPROVED",
  confidence: 0.97,
  narrative: "verified · static badge issued",
  construct_slug: "verify-grader",
  graded_at: "2026-05-31T12:00:00.000Z",
  contract_version: "1.0.0",
};

// ---------------------------------------------------------------------------
// Tag identity — same port as the Null + stub Layers (additive)
// ---------------------------------------------------------------------------

describe("BadgeIssuancePortStaticLayer — Tag identity (additive third Layer)", () => {
  it("binds the exact same Tag as Null + asset-pipeline-stub Layers", () => {
    expect(BadgeIssuancePort.key).toBe(BADGE_ISSUANCE_PORT_TAG_IDENTITY);
    expect(BADGE_ISSUANCE_PORT_TAG_IDENTITY).toBe(
      "@freeside-quests/BadgeIssuancePort",
    );
  });
});

// ---------------------------------------------------------------------------
// Static registry — verify mapping present + valid BadgeArtifact shape
// ---------------------------------------------------------------------------

describe("STATIC_BADGE_REGISTRY — verify mapping", () => {
  it("includes a 'verify' badge with the CloudFront URI", () => {
    const verify = STATIC_BADGE_REGISTRY.verify;
    expect(verify).toBeDefined();
    expect(verify?.uri).toBe(
      "https://d163aeqznbc6js.cloudfront.net/images/faucet/badges/verify.png",
    );
  });

  it("resolveStaticBadge produces a BadgeArtifact that decodes through the real schema", () => {
    const artifact = resolveStaticBadge("verify", "2026-05-31T12:00:00.000Z");
    expect(artifact).not.toBeNull();
    // Decoding through the sealed protocol schema proves the shape is exact.
    const decoded = Schema.decodeUnknownSync(BadgeArtifact)(artifact);
    expect(decoded.uri).toBe(
      "https://d163aeqznbc6js.cloudfront.net/images/faucet/badges/verify.png",
    );
    expect(decoded.generated_format).toBe("png");
    expect(decoded.issued_at).toBe("2026-05-31T12:00:00.000Z");
  });

  it("resolveStaticBadge returns null for an unknown badgeId", () => {
    expect(resolveStaticBadge("not-a-mapped-family", "2026-05-31T12:00:00.000Z")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Layer behavior — known family resolves the artifact, unknown stays null
// ---------------------------------------------------------------------------

describe("BadgeIssuancePortStaticLayer — issue() via the port", () => {
  it("returns the verify BadgeArtifact for a known badge family + APPROVED verdict", async () => {
    const program = Effect.gen(function* () {
      const port = yield* BadgeIssuancePort;
      return yield* port.issue(verifyQuest, verdictApproved, verifiedPlayer);
    }).pipe(Effect.provide(BadgeIssuancePortStaticLayer));

    const result = await Effect.runPromise(program);
    expect(result).not.toBeNull();
    expect(result?.uri).toBe(
      "https://d163aeqznbc6js.cloudfront.net/images/faucet/badges/verify.png",
    );
    expect(result?.generated_format).toBe("png");
    expect(result?.prompt_seed_used).toBe("static:verify-badge");
    // issued_at is a non-empty RFC3339-ish timestamp stamped per issuance.
    expect(typeof result?.issued_at).toBe("string");
    expect((result?.issued_at ?? "").length).toBeGreaterThan(0);
    // The port output satisfies the sealed BadgeArtifact schema precisely.
    expect(() => Schema.decodeUnknownSync(BadgeArtifact)(result)).not.toThrow();
  });

  it("returns null for a quest whose badge family is not in the static registry", async () => {
    const program = Effect.gen(function* () {
      const port = yield* BadgeIssuancePort;
      return yield* port.issue(unknownQuest, verdictApproved, verifiedPlayer);
    }).pipe(Effect.provide(BadgeIssuancePortStaticLayer));

    const result = await Effect.runPromise(program);
    expect(result).toBeNull();
  });
});
