/**
 * Auth modes test — 3-mode coverage per AC-4.4 + SDD §4.3 + §4.5.
 *
 * Validates:
 *   - `AuthCheckPortAnonLayer` returns `is_verified` derived from
 *     `PlayerIdentity.type` (verified vs anon).
 *   - `BadgeIssuancePortNullLayer` returns null for any (quest, verdict,
 *     player) tuple.
 *   - `EngineConfig.questAcceptanceMode` accepts all 3 literals + the
 *     `defaultEngineConfig()` factory returns `'open-badge-gated'` per D4.
 *   - Composition: anon player + 'open-badge-gated' = badge gate engaged
 *     (auth check fails), verified player + same mode = gate passes.
 *
 * NOT a state-machine test — that's Q4.3's stub-quest e2e integration
 * test. This is a focused 3-mode contract test for the new ports +
 * config surface.
 *
 * Cycle-Q · 2026-05-04 · sprint-4 SEAMS · Q4.2.
 */

import { describe, expect, it } from "vitest";
import { Effect, Layer, Schema } from "effect";
import {
  type Quest,
  type QuestVerdict,
  type PlayerIdentity,
  QuestId,
  NpcId,
  BadgeFamilyId,
  WorldSlug,
} from "@0xhoneyjar/quests-protocol";

import {
  AuthCheckPort,
  AuthCheckPortAnonLayer,
  AUTH_CHECK_PORT_TAG_IDENTITY,
  type AuthCheck,
} from "../auth/index.js";
import {
  BadgeIssuancePort,
  BadgeIssuancePortNullLayer,
  BADGE_ISSUANCE_PORT_TAG_IDENTITY,
} from "../badge/index.js";
import {
  EngineConfig,
  QuestAcceptanceMode,
  defaultEngineConfig,
} from "../config.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const anonPlayer: PlayerIdentity = {
  type: "anon",
  discord_id: Schema.decodeUnknownSync(
    Schema.String.pipe(
      Schema.brand("DiscordId"),
      Schema.pattern(/^\d{17,20}$/),
    ),
  )("123456789012345678"),
};

const verifiedPlayer: PlayerIdentity = {
  type: "verified",
  wallet: Schema.decodeUnknownSync(
    Schema.String.pipe(
      Schema.brand("PlayerWallet"),
      Schema.pattern(/^0x[a-f0-9]{40}$/),
    ),
  )("0xabcdef0123456789abcdef0123456789abcdef01"),
  discord_id: Schema.decodeUnknownSync(
    Schema.String.pipe(
      Schema.brand("DiscordId"),
      Schema.pattern(/^\d{17,20}$/),
    ),
  )("987654321098765432"),
};

const stubQuest: Quest = {
  quest_id: Schema.decodeUnknownSync(QuestId)("stub-quest-001"),
  npc_pointer: Schema.decodeUnknownSync(NpcId)("stub-npc"),
  world_slug: Schema.decodeUnknownSync(WorldSlug)("stub-world"),
  title: "Stub quest",
  prompt: "stub prompt — substrate-only validation, no curator content",
  rubric_pointer: { type: "url", url: "https://example.invalid/rubric" },
  badge_spec: {
    family_id: Schema.decodeUnknownSync(BadgeFamilyId)("stub-badge-family"),
    display_name: "Stub Badge",
    prompt_seed: "stub prompt seed for substrate validation",
  },
  published_at: "2026-05-04T11:59:00.000Z",
  step_count: 1 as const,
  contract_version: "1.0.0",
};

const stubVerdictApproved: QuestVerdict = {
  submission_id: "sub-001",
  trace_id: "trace-001",
  status: "APPROVED",
  confidence: 0.91,
  narrative: "the steppe nods · stub validation",
  construct_slug: "stub-grader",
  graded_at: "2026-05-04T12:00:00.000Z",
  contract_version: "1.0.0",
};

// ---------------------------------------------------------------------------
// Tag identity contracts
// ---------------------------------------------------------------------------

describe("Auth + Badge port Tag identity (cross-pack)", () => {
  it("AuthCheckPort identity string is exactly '@freeside-quests/AuthCheckPort'", () => {
    expect(AUTH_CHECK_PORT_TAG_IDENTITY).toBe("@freeside-quests/AuthCheckPort");
    expect(AuthCheckPort.key).toBe(AUTH_CHECK_PORT_TAG_IDENTITY);
  });

  it("BadgeIssuancePort identity string is exactly '@freeside-quests/BadgeIssuancePort'", () => {
    expect(BADGE_ISSUANCE_PORT_TAG_IDENTITY).toBe(
      "@freeside-quests/BadgeIssuancePort",
    );
    expect(BadgeIssuancePort.key).toBe(BADGE_ISSUANCE_PORT_TAG_IDENTITY);
  });
});

// ---------------------------------------------------------------------------
// AuthCheckPortAnonLayer — derives is_verified from PlayerIdentity tag
// ---------------------------------------------------------------------------

describe("AuthCheckPortAnonLayer — anon-allowed default (PRD D4)", () => {
  it("returns is_verified=false for anon players", async () => {
    const program = Effect.gen(function* () {
      const port = yield* AuthCheckPort;
      return yield* port.check(anonPlayer);
    }).pipe(Effect.provide(AuthCheckPortAnonLayer));

    const result: AuthCheck = await Effect.runPromise(program);
    expect(result.is_verified).toBe(false);
    expect(result.display_handle).toBeUndefined();
  });

  it("returns is_verified=true for verified players", async () => {
    const program = Effect.gen(function* () {
      const port = yield* AuthCheckPort;
      return yield* port.check(verifiedPlayer);
    }).pipe(Effect.provide(AuthCheckPortAnonLayer));

    const result: AuthCheck = await Effect.runPromise(program);
    expect(result.is_verified).toBe(true);
    expect(result.display_handle).toBeUndefined(); // sibling Session A populates
  });
});

// ---------------------------------------------------------------------------
// BadgeIssuancePortNullLayer — always null
// ---------------------------------------------------------------------------

describe("BadgeIssuancePortNullLayer — default (no artifact)", () => {
  it("returns null for verified player + APPROVED verdict", async () => {
    const program = Effect.gen(function* () {
      const port = yield* BadgeIssuancePort;
      return yield* port.issue(stubQuest, stubVerdictApproved, verifiedPlayer);
    }).pipe(Effect.provide(BadgeIssuancePortNullLayer));

    const result = await Effect.runPromise(program);
    expect(result).toBeNull();
  });

  it("returns null for anon player + APPROVED verdict (D4 anon path)", async () => {
    const program = Effect.gen(function* () {
      const port = yield* BadgeIssuancePort;
      return yield* port.issue(stubQuest, stubVerdictApproved, anonPlayer);
    }).pipe(Effect.provide(BadgeIssuancePortNullLayer));

    const result = await Effect.runPromise(program);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// EngineConfig — 3-mode literal coverage + default factory (AC-4.3, AC-4.4)
// ---------------------------------------------------------------------------

describe("EngineConfig.questAcceptanceMode — 3-mode coverage (PRD D4)", () => {
  const decode = Schema.decodeUnknownSync(EngineConfig);

  it("accepts mode 'open' (anon accept · no badge gate)", () => {
    const cfg = decode({
      questAcceptanceMode: "open",
      worldSlug: "stub-world",
      submissionStyle: "inline_thread",
      positiveFrictionDelayMs: 0,
    });
    expect(cfg.questAcceptanceMode).toBe("open");
  });

  it("accepts mode 'auth-required' (verified accept)", () => {
    const cfg = decode({
      questAcceptanceMode: "auth-required",
      worldSlug: "stub-world",
      submissionStyle: "inline_thread",
      positiveFrictionDelayMs: 0,
    });
    expect(cfg.questAcceptanceMode).toBe("auth-required");
  });

  it("accepts mode 'open-badge-gated' (DEFAULT · D4)", () => {
    const cfg = decode({
      questAcceptanceMode: "open-badge-gated",
      worldSlug: "stub-world",
      submissionStyle: "inline_thread",
      positiveFrictionDelayMs: 0,
    });
    expect(cfg.questAcceptanceMode).toBe("open-badge-gated");
  });

  it("rejects modes outside the 3-literal enum", () => {
    expect(() =>
      decode({
        questAcceptanceMode: "anonymous-jubilee", // not a real mode
        worldSlug: "stub-world",
        submissionStyle: "inline_thread",
        positiveFrictionDelayMs: 0,
      }),
    ).toThrow();
  });

  it("QuestAcceptanceMode literal Schema validates all 3 modes", () => {
    const decodeMode = Schema.decodeUnknownSync(QuestAcceptanceMode);
    expect(decodeMode("open")).toBe("open");
    expect(decodeMode("auth-required")).toBe("auth-required");
    expect(decodeMode("open-badge-gated")).toBe("open-badge-gated");
  });

  it("defaultEngineConfig() returns 'open-badge-gated' per PRD D4", () => {
    const cfg = defaultEngineConfig("stub-world");
    expect(cfg.questAcceptanceMode).toBe("open-badge-gated");
    expect(cfg.worldSlug).toBe("stub-world");
    expect(cfg.submissionStyle).toBe("inline_thread");
    expect(cfg.positiveFrictionDelayMs).toBe(0);
  });

  it("rejects positiveFrictionDelayMs out of [0, 30000] range", () => {
    expect(() =>
      decode({
        questAcceptanceMode: "open",
        worldSlug: "stub-world",
        submissionStyle: "inline_thread",
        positiveFrictionDelayMs: -1,
      }),
    ).toThrow();
    expect(() =>
      decode({
        questAcceptanceMode: "open",
        worldSlug: "stub-world",
        submissionStyle: "inline_thread",
        positiveFrictionDelayMs: 30001,
      }),
    ).toThrow();
  });

  it("rejects worldSlug that doesn't match kebab-case pattern", () => {
    expect(() =>
      decode({
        questAcceptanceMode: "open",
        worldSlug: "Stub_World", // PascalCase + underscore = invalid
        submissionStyle: "inline_thread",
        positiveFrictionDelayMs: 0,
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Composition — verify auth + badge layers compose without conflict
// ---------------------------------------------------------------------------

describe("Auth + Badge layer composition (sprint-4 surface)", () => {
  it("default Layers compose into a single Layer with both ports", async () => {
    const composed = Layer.merge(
      AuthCheckPortAnonLayer,
      BadgeIssuancePortNullLayer,
    );

    const program = Effect.gen(function* () {
      const auth = yield* AuthCheckPort;
      const badge = yield* BadgeIssuancePort;
      const authResult = yield* auth.check(anonPlayer);
      const badgeResult = yield* badge.issue(
        stubQuest,
        stubVerdictApproved,
        anonPlayer,
      );
      return { authResult, badgeResult };
    }).pipe(Effect.provide(composed));

    const { authResult, badgeResult } = await Effect.runPromise(program);
    expect(authResult.is_verified).toBe(false);
    expect(badgeResult).toBeNull();
  });

  it("'open-badge-gated' mode + verified player + AuthCheck = is_verified=true", async () => {
    const cfg = defaultEngineConfig("stub-world");
    expect(cfg.questAcceptanceMode).toBe("open-badge-gated");

    const program = Effect.gen(function* () {
      const auth = yield* AuthCheckPort;
      return yield* auth.check(verifiedPlayer);
    }).pipe(Effect.provide(AuthCheckPortAnonLayer));

    const result = await Effect.runPromise(program);
    expect(result.is_verified).toBe(true);
    // In 'open-badge-gated' mode + is_verified=true, the bot consumer
    // would call BadgeIssuancePort.issue. Here the default null Layer
    // returns null; Cycle B + Track A swap in the production adapter.
  });

  it("'open-badge-gated' mode + anon player + AuthCheck = is_verified=false", async () => {
    const program = Effect.gen(function* () {
      const auth = yield* AuthCheckPort;
      return yield* auth.check(anonPlayer);
    }).pipe(Effect.provide(AuthCheckPortAnonLayer));

    const result = await Effect.runPromise(program);
    expect(result.is_verified).toBe(false);
    // In 'open-badge-gated' mode + is_verified=false, the bot consumer
    // would skip BadgeIssuancePort.issue (anon path · null badge_uri ·
    // soft conversion via /verify later).
  });
});
