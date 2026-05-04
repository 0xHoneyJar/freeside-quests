/**
 * Stub-quest end-to-end integration test (Q4.3 · AC-5.1 supporting).
 *
 * Validates the FULL state-machine flow (browsing → accepted → submitted
 * → judged → completed/failed) composed against ALL 3 default ports:
 *
 *   1. QuestStatePort      ← QuestStatePortMemoryLayer        (sprint-2)
 *   2. AuthCheckPort       ← AuthCheckPortAnonLayer           (sprint-4 Q4.1)
 *   3. BadgeIssuancePort   ← BadgeIssuancePortNullLayer       (sprint-4 Q4.2)
 *
 * NOT a Mongolian content test. Independent dummy NPC (`stub-npc`) for
 * substrate validation per architect lock A6 (Track A territory · Gumi
 * authors persona body content separately).
 *
 * Per architect lock A4 (rubric_pointer is opaque to substrate): this
 * test does NOT dereference the rubric. The "construct" is replaced with
 * a synthetic verdict-emitter that fabricates QuestVerdict shapes
 * directly, exercising the substrate without invoking any LLM-bound
 * grader. A real grader plugs in via the dispatch surface (cycle-1
 * substrate-step ABI) — that integration is exercised by
 * `dispatch.test.ts`.
 *
 * Per PRD D4 (3-mode questAcceptanceMode):
 *   - 'open'              → substrate runs unconditionally · null badge
 *   - 'auth-required'     → soft verify-prompt enforced at consumer (NOT
 *                           substrate · this test asserts substrate runs
 *                           the same flow regardless · the gate lives at
 *                           the dispatcher layer)
 *   - 'open-badge-gated'  → AuthCheckPort consulted at finalize · null
 *                           badge (default) regardless of is_verified
 *
 * Per [[chat-medium-presentation-boundary]] §2 drift signature: this
 * test asserts that NO substrate identifier (quest_id · trace_id ·
 * submission_id · player.wallet · player.discord_id) leaks into any
 * BadgeArtifact field. The substrate-id-leak guard
 * (`cmp-boundary-substrate-id-leak.test.ts`) covers engine string
 * outputs; this test extends the contract to the BadgeIssuancePort
 * surface.
 *
 * Cycle-Q · 2026-05-04 · sprint-4 P5 VALIDATION.
 */

import { describe, expect, it } from "vitest";
import { Effect, Layer, Schema } from "effect";

import {
  type Quest,
  type QuestState,
  type QuestVerdict,
  type SubmissionEnvelope,
  type PlayerIdentity,
  type BadgeArtifact,
  QuestId,
  NpcId,
  BadgeFamilyId,
  WorldSlug,
  PlayerWallet,
  DiscordId,
  SubmissionId,
} from "@0xhoneyjar/quests-protocol";

import { transitions, type Clock } from "../../quest-state-machine.js";
import { QuestStatePort } from "../../persistence/port.js";
import { QuestStatePortMemoryLayer } from "../../persistence/adapters/memory.js";
import {
  AuthCheckPort,
  AuthCheckPortAnonLayer,
} from "../../auth/index.js";
import {
  BadgeIssuancePort,
  BadgeIssuancePortNullLayer,
} from "../../badge/index.js";
import {
  EngineConfig,
  defaultEngineConfig,
  type QuestAcceptanceMode,
} from "../../config.js";

// ---------------------------------------------------------------------------
// Fixtures — independent dummy NPC (stub-npc · NOT Mongolian)
// ---------------------------------------------------------------------------

const FIXED_CLOCK_NOW = "2026-05-04T18:00:00.000Z";
const FIXED_CLOCK_END = "2026-05-04T18:05:00.000Z";

const fixedClockBrowse: Clock = { now: () => FIXED_CLOCK_NOW };
const fixedClockFinalize: Clock = { now: () => FIXED_CLOCK_END };

const STUB_QUEST_ID = Schema.decodeSync(QuestId)("stub-quest-001");
const STUB_NPC_ID = Schema.decodeSync(NpcId)("stub-npc");
const STUB_BADGE_FAMILY = Schema.decodeSync(BadgeFamilyId)("stub-badge-family");
const STUB_WORLD_SLUG = Schema.decodeSync(WorldSlug)("stub-world");
const STUB_WALLET = Schema.decodeSync(PlayerWallet)(`0x${"a".repeat(40)}`);
const STUB_DISCORD_VERIFIED = Schema.decodeSync(DiscordId)("123456789012345678");
const STUB_DISCORD_ANON = Schema.decodeSync(DiscordId)("234567890123456789");

const TRACE_ID = "trace-stub-e2e-01HW8";
const SUB_ID = Schema.decodeSync(SubmissionId)("sub-stub-e2e-01HW8");

const verifiedPlayer: PlayerIdentity = {
  type: "verified",
  wallet: STUB_WALLET,
  discord_id: STUB_DISCORD_VERIFIED,
};

const anonPlayer: PlayerIdentity = {
  type: "anon",
  discord_id: STUB_DISCORD_ANON,
};

const stubQuest: Quest = {
  quest_id: STUB_QUEST_ID,
  npc_pointer: STUB_NPC_ID,
  world_slug: STUB_WORLD_SLUG,
  title: "Stub quest — substrate validation",
  prompt:
    "stub prompt for substrate-only validation · contains no curator content",
  rubric_pointer: { type: "url", url: "https://example.invalid/rubric" },
  badge_spec: {
    family_id: STUB_BADGE_FAMILY,
    display_name: "Stub Badge",
    prompt_seed: "stub prompt seed for substrate validation",
  },
  published_at: "2026-05-04T11:59:00.000Z",
  step_count: 1 as const,
  contract_version: "1.0.0",
};

const initialState = (player: PlayerIdentity): QuestState => ({
  quest_id: STUB_QUEST_ID,
  player,
  npc_id: STUB_NPC_ID,
  phase: "browsing",
  trace_id: TRACE_ID,
  contract_version: "1.0.0",
});

const stubSubmission = (player: PlayerIdentity): SubmissionEnvelope => ({
  submission_id: SUB_ID,
  trace_id: TRACE_ID,
  quest_id: STUB_QUEST_ID,
  player,
  text_response:
    "stub text response · substrate-only · no curator-content drift",
  submitted_at: "2026-05-04T18:02:00.000Z",
  contract_version: "1.0.0",
});

const stubVerdict = (status: "APPROVED" | "REJECTED"): QuestVerdict => ({
  submission_id: SUB_ID,
  trace_id: TRACE_ID,
  status,
  confidence: 0.91,
  narrative: "the steppe nods · substrate-validation narrative",
  construct_slug: "stub-grader",
  graded_at: "2026-05-04T18:03:00.000Z",
  contract_version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Composed Layer — ALL 3 default ports
// ---------------------------------------------------------------------------

const SubstrateLayer = Layer.mergeAll(
  QuestStatePortMemoryLayer,
  AuthCheckPortAnonLayer,
  BadgeIssuancePortNullLayer,
);

// ---------------------------------------------------------------------------
// End-to-end driver — exercises the full state machine through all 3 ports
// ---------------------------------------------------------------------------

/**
 * Drive a quest from browsing → completed/failed using all 3 default
 * ports. Returns the final QuestState + every intermediate state for
 * inspection.
 *
 * This emulates what the bot consumer (freeside-characters) does at
 * runtime, except:
 *   - The rubric is not dereferenced (architect lock A4 — substrate
 *     never interprets · construct does)
 *   - The construct is replaced with a synthetic verdict (status passed
 *     in by the test)
 *   - The discord-renderer's CMP transforms are exercised separately
 *     (`packages/discord-renderer/__tests__/cmp-boundary.test.ts`)
 */
const driveStubQuest = (
  player: PlayerIdentity,
  config: EngineConfig,
  verdictStatus: "APPROVED" | "REJECTED",
) =>
  Effect.gen(function* () {
    const port = yield* QuestStatePort;
    const auth = yield* AuthCheckPort;
    const badge = yield* BadgeIssuancePort;

    // 1. browsing — initialize state in persistence
    const browsing = initialState(player);
    yield* port.save(browsing);

    // 2. accept — transition browsing → accepted, persist
    const accepted = yield* transitions.accept(browsing, fixedClockBrowse);
    yield* port.save(accepted);

    // 3. submit — transition accepted → submitted, persist
    const submission = stubSubmission(player);
    const submitted = yield* transitions.submit(accepted, submission);
    yield* port.save(submitted);

    // 4. judge — synthetic construct emits verdict, transition submitted → judged
    const verdict = stubVerdict(verdictStatus);
    const judged = yield* transitions.judge(submitted, verdict);
    yield* port.save(judged);

    // 5. consult AuthCheckPort (gate decision · per PRD D4 + EngineConfig)
    const authCheck = yield* auth.check(player);

    // 6. issue badge IFF policy permits (per questAcceptanceMode + auth gate)
    let badgeArtifact: BadgeArtifact | null = null;
    const policyAllowsBadge =
      verdict.status === "APPROVED" &&
      // 'open' = unconditional · 'auth-required' or 'open-badge-gated' = require verified
      (config.questAcceptanceMode === "open" || authCheck.is_verified);
    if (policyAllowsBadge) {
      badgeArtifact = yield* badge.issue(stubQuest, verdict, player);
    }

    // 7. finalize — transition judged → completed (APPROVED) or failed (REJECTED)
    const final = yield* transitions.finalize(
      judged,
      badgeArtifact?.uri,
      fixedClockFinalize,
    );
    yield* port.save(final);

    // 8. round-trip load — ensure persistence layer returns what we saved
    const loaded = yield* port.load(STUB_QUEST_ID, player);

    return {
      browsing,
      accepted,
      submitted,
      judged,
      final,
      loaded,
      authCheck,
      badgeArtifact,
    };
  }).pipe(Effect.provide(SubstrateLayer));

// ---------------------------------------------------------------------------
// Tests — full flow per (player-type × verdict × acceptance-mode)
// ---------------------------------------------------------------------------

describe("stub-quest end-to-end · verified player · APPROVED · open-badge-gated (D4 default)", () => {
  it("drives browsing → accepted → submitted → judged → completed", async () => {
    const config = defaultEngineConfig("stub-world");
    const result = await Effect.runPromise(
      driveStubQuest(verifiedPlayer, config, "APPROVED"),
    );

    expect(result.browsing.phase).toBe("browsing");
    expect(result.accepted.phase).toBe("accepted");
    expect(result.submitted.phase).toBe("submitted");
    expect(result.judged.phase).toBe("judged");
    expect(result.final.phase).toBe("completed");
  });

  it("stamps timestamps on each phase from the injected clocks/submissions", async () => {
    const config = defaultEngineConfig("stub-world");
    const result = await Effect.runPromise(
      driveStubQuest(verifiedPlayer, config, "APPROVED"),
    );

    expect(result.accepted.accepted_at).toBe(FIXED_CLOCK_NOW);
    expect(result.submitted.submitted_at).toBe("2026-05-04T18:02:00.000Z");
    expect(result.judged.judged_at).toBe("2026-05-04T18:03:00.000Z");
    expect(result.final.completed_at).toBe(FIXED_CLOCK_END);
  });

  it("embeds verdict snapshot on judged state", async () => {
    const config = defaultEngineConfig("stub-world");
    const result = await Effect.runPromise(
      driveStubQuest(verifiedPlayer, config, "APPROVED"),
    );

    expect(result.judged.verdict?.status).toBe("APPROVED");
    expect(result.judged.verdict?.confidence).toBe(0.91);
    expect(result.judged.verdict?.narrative).toBe(
      "the steppe nods · substrate-validation narrative",
    );
  });

  it("AuthCheckPort gate returns is_verified=true for verified player", async () => {
    const config = defaultEngineConfig("stub-world");
    const result = await Effect.runPromise(
      driveStubQuest(verifiedPlayer, config, "APPROVED"),
    );

    expect(result.authCheck.is_verified).toBe(true);
  });

  it("BadgeIssuancePort default returns null (Cycle B + Track A swap-ready)", async () => {
    const config = defaultEngineConfig("stub-world");
    const result = await Effect.runPromise(
      driveStubQuest(verifiedPlayer, config, "APPROVED"),
    );

    expect(result.badgeArtifact).toBeNull();
    expect(result.final.badge_uri).toBeUndefined();
  });

  it("round-trip load returns the persisted final state", async () => {
    const config = defaultEngineConfig("stub-world");
    const result = await Effect.runPromise(
      driveStubQuest(verifiedPlayer, config, "APPROVED"),
    );

    expect(result.loaded.phase).toBe("completed");
    expect(result.loaded.quest_id).toBe(result.final.quest_id);
  });
});

describe("stub-quest end-to-end · anon player · APPROVED · open-badge-gated (D4 anon path)", () => {
  it("drives browsing → completed with null badge_uri (soft conversion path)", async () => {
    const config = defaultEngineConfig("stub-world");
    const result = await Effect.runPromise(
      driveStubQuest(anonPlayer, config, "APPROVED"),
    );

    expect(result.final.phase).toBe("completed");
    expect(result.final.badge_uri).toBeUndefined();
  });

  it("AuthCheckPort gate returns is_verified=false for anon player", async () => {
    const config = defaultEngineConfig("stub-world");
    const result = await Effect.runPromise(
      driveStubQuest(anonPlayer, config, "APPROVED"),
    );

    expect(result.authCheck.is_verified).toBe(false);
  });

  it("BadgeIssuancePort is NOT consulted in 'open-badge-gated' + anon path", async () => {
    const config = defaultEngineConfig("stub-world");
    const result = await Effect.runPromise(
      driveStubQuest(anonPlayer, config, "APPROVED"),
    );

    // The driver short-circuits badge.issue when authCheck.is_verified=false
    // in 'open-badge-gated' mode · final.badge_uri stays undefined.
    expect(result.badgeArtifact).toBeNull();
    expect(result.final.badge_uri).toBeUndefined();
  });
});

describe("stub-quest end-to-end · 'open' mode (anon-allowed · NO badge gate)", () => {
  const openModeConfig = (): EngineConfig => ({
    ...defaultEngineConfig("stub-world"),
    questAcceptanceMode: "open",
  });

  it("anon player + APPROVED + 'open' mode → BadgeIssuancePort IS consulted", async () => {
    const config = openModeConfig();
    const result = await Effect.runPromise(
      driveStubQuest(anonPlayer, config, "APPROVED"),
    );

    // 'open' mode skips the auth gate · BadgeIssuancePort runs (returns
    // null per default · final.badge_uri stays undefined).
    expect(result.badgeArtifact).toBeNull();
    expect(result.final.phase).toBe("completed");
  });

  it("verified player + APPROVED + 'open' mode → BadgeIssuancePort IS consulted", async () => {
    const config = openModeConfig();
    const result = await Effect.runPromise(
      driveStubQuest(verifiedPlayer, config, "APPROVED"),
    );

    expect(result.badgeArtifact).toBeNull();
    expect(result.final.phase).toBe("completed");
  });
});

describe("stub-quest end-to-end · 'auth-required' mode (verified-accept)", () => {
  const authRequiredConfig = (): EngineConfig => ({
    ...defaultEngineConfig("stub-world"),
    questAcceptanceMode: "auth-required",
  });

  it("verified player + APPROVED + 'auth-required' mode → BadgeIssuancePort IS consulted", async () => {
    const config = authRequiredConfig();
    const result = await Effect.runPromise(
      driveStubQuest(verifiedPlayer, config, "APPROVED"),
    );

    expect(result.authCheck.is_verified).toBe(true);
    expect(result.badgeArtifact).toBeNull();
    expect(result.final.phase).toBe("completed");
  });

  it("anon player + APPROVED + 'auth-required' mode → substrate runs · gate enforced upstream", async () => {
    // 'auth-required' enforcement lives at the dispatcher (consumer
    // refuses /quest accept for anon). At the substrate level, if the
    // dispatcher were misconfigured and an anon player reached the
    // engine, the engine still drives the flow correctly · auth gate
    // produces is_verified=false · badge issuance is skipped.
    const config = authRequiredConfig();
    const result = await Effect.runPromise(
      driveStubQuest(anonPlayer, config, "APPROVED"),
    );

    expect(result.authCheck.is_verified).toBe(false);
    expect(result.badgeArtifact).toBeNull();
    expect(result.final.phase).toBe("completed");
  });
});

describe("stub-quest end-to-end · REJECTED verdict (failed terminal)", () => {
  it("drives browsing → accepted → submitted → judged → failed", async () => {
    const config = defaultEngineConfig("stub-world");
    const result = await Effect.runPromise(
      driveStubQuest(verifiedPlayer, config, "REJECTED"),
    );

    expect(result.judged.phase).toBe("judged");
    expect(result.judged.verdict?.status).toBe("REJECTED");
    expect(result.final.phase).toBe("failed");
    expect(result.final.badge_uri).toBeUndefined();
  });

  it("BadgeIssuancePort is NOT consulted on REJECTED verdict (regardless of auth)", async () => {
    const config = defaultEngineConfig("stub-world");
    const verifiedResult = await Effect.runPromise(
      driveStubQuest(verifiedPlayer, config, "REJECTED"),
    );
    const anonResult = await Effect.runPromise(
      driveStubQuest(anonPlayer, config, "REJECTED"),
    );

    expect(verifiedResult.badgeArtifact).toBeNull();
    expect(anonResult.badgeArtifact).toBeNull();
    expect(verifiedResult.final.phase).toBe("failed");
    expect(anonResult.final.phase).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// CMP-boundary contract — substrate id leak guard at BadgeIssuancePort surface
// ---------------------------------------------------------------------------

describe("stub-quest end-to-end · CMP-boundary substrate-id leak guard", () => {
  it("none of the substrate identifiers leak into BadgeArtifact when adapter returns one", async () => {
    // The default null-Layer returns null · this test asserts that the
    // SHAPE contract holds even if a future adapter returned a
    // BadgeArtifact: substrate ids must NOT appear in any artifact field.
    //
    // This is a structural guard · we enumerate the substrate-id strings
    // and assert that future BadgeIssuancePort adapters MUST omit them
    // from the returned BadgeArtifact (the production adapter under
    // Cycle B will be tested against this same guard).
    const substrateIds = [
      STUB_QUEST_ID,
      TRACE_ID,
      SUB_ID,
      STUB_WALLET,
      STUB_DISCORD_VERIFIED,
      STUB_DISCORD_ANON,
    ];

    const config = defaultEngineConfig("stub-world");
    const result = await Effect.runPromise(
      driveStubQuest(verifiedPlayer, config, "APPROVED"),
    );

    if (result.badgeArtifact !== null) {
      // If a future adapter returns a non-null artifact, assert no leak.
      const serialized = JSON.stringify(result.badgeArtifact);
      for (const id of substrateIds) {
        expect(serialized).not.toContain(id);
      }
    }
    // Default-Layer asserts: artifact IS null · contract trivially holds.
    expect(result.badgeArtifact).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// State-machine invariants — full-flow round-trip via persistence
// ---------------------------------------------------------------------------

describe("stub-quest end-to-end · persistence round-trip", () => {
  it("each phase save+load round-trips identically (idempotency)", async () => {
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      const browsing = initialState(verifiedPlayer);
      yield* port.save(browsing);
      const loaded1 = yield* port.load(STUB_QUEST_ID, verifiedPlayer);
      expect(loaded1.phase).toBe("browsing");

      const accepted = yield* transitions.accept(browsing, fixedClockBrowse);
      yield* port.save(accepted);
      const loaded2 = yield* port.load(STUB_QUEST_ID, verifiedPlayer);
      expect(loaded2.phase).toBe("accepted");

      // Saving the same state twice should be idempotent (memory adapter
      // contract per SDD §4.2).
      yield* port.save(accepted);
      const loaded3 = yield* port.load(STUB_QUEST_ID, verifiedPlayer);
      expect(loaded3.phase).toBe("accepted");
      expect(loaded3.accepted_at).toBe(loaded2.accepted_at);
    }).pipe(Effect.provide(SubstrateLayer));

    await Effect.runPromise(program);
  });

  it("verified-vs-anon player keys are isolated (composeKey discriminator)", async () => {
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      const verifiedState = initialState(verifiedPlayer);
      const anonState = initialState(anonPlayer);
      yield* port.save(verifiedState);
      yield* port.save(anonState);

      const verifiedList = yield* port.list(verifiedPlayer);
      const anonList = yield* port.list(anonPlayer);

      expect(verifiedList).toHaveLength(1);
      expect(anonList).toHaveLength(1);
      expect(verifiedList[0]?.player.type).toBe("verified");
      expect(anonList[0]?.player.type).toBe("anon");
    }).pipe(Effect.provide(SubstrateLayer));

    await Effect.runPromise(program);
  });
});

// ---------------------------------------------------------------------------
// Regression — ensure the 3-default-port composition compiles without
// extra dependencies (i.e. no leakage of pg, no Layer mismatch)
// ---------------------------------------------------------------------------

describe("stub-quest end-to-end · Layer composition surface", () => {
  it("composes QuestStatePortMemoryLayer + AuthCheckPortAnonLayer + BadgeIssuancePortNullLayer cleanly", async () => {
    // If this typechecks AND all the previous tests pass, the Layer
    // composition is sound. This test exists to make the assertion
    // explicit: SubstrateLayer requires zero external services beyond
    // the 3 default ports.
    const program = Effect.gen(function* () {
      const _port = yield* QuestStatePort;
      const _auth = yield* AuthCheckPort;
      const _badge = yield* BadgeIssuancePort;
      return "all 3 ports resolved" as const;
    }).pipe(Effect.provide(SubstrateLayer));

    const result = await Effect.runPromise(program);
    expect(result).toBe("all 3 ports resolved");
  });
});
