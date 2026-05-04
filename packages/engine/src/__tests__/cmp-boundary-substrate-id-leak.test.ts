/**
 * CMP-boundary substrate-id-leak guard test.
 *
 * Per SDD §9.2 AC-2.5 + [[chat-medium-presentation-boundary]] §2 drift
 * signature: NO substrate IDs (`quest_uuid` · `trace_id` · `submission_id`)
 * may leak into user-facing string outputs.
 *
 * The engine layer (cycle-Q sprint-2) is upstream of the renderer, so this
 * guard fires at the EARLIEST opportunity — the state-machine. Sprint-3's
 * discord-renderer will extend the same guard at the actual presentation
 * boundary (CMP transform 7 · `filterTelemetryFromOutput`).
 *
 * Drift signature regexes:
 *   - UUID v4: 8-4-4-4-12 hex with hyphens
 *   - 26-char ULID/ksuid (lowercase)
 *   - hex strings ≥ 32 chars (catches sketchy custom ids)
 *
 * Safe fields where IDs are EXPECTED:
 *   - QuestState.quest_id           (user-facing slug · `quest-mongolian-001`)
 *   - QuestState.player.discord_id  (snowflake · cosmetic for renderer)
 *   - QuestState.player.wallet      (0x... · user-facing handle equivalent)
 *
 * Banned-leak fields:
 *   - QuestState.trace_id           (telemetry only · NEVER user-visible)
 *   - QuestState.verdict.*          (must NOT carry submission_id/trace_id)
 *   - SubmissionEnvelope.trace_id   (telemetry only)
 *   - SubmissionEnvelope.submission_id (mostly telemetry · NEVER in user-facing
 *                                       fields like narrative/curator quote)
 *
 * Cycle-Q · 2026-05-04 · sprint-2 ENGINE+PERSIST.
 */

import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";

import {
  accept,
  submit,
  judge,
  finalize,
} from "../quest-state-machine.js";
import {
  type QuestState,
  type QuestVerdict,
  type SubmissionEnvelope,
  type PlayerIdentity,
  QuestId,
  NpcId,
  PlayerWallet,
  DiscordId,
} from "@freeside-quests/protocol";

// ---------------------------------------------------------------------------
// Drift signatures
// ---------------------------------------------------------------------------

const UUID_V4_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ULID_RE = /\b[0-9A-HJKMNP-TV-Z]{26}\b/i; // Crockford base32 26-char
const LONG_HEX_RE = /\b[0-9a-f]{32,}\b/i;

const SUBSTRATE_UUID_TRACE = "11111111-2222-4333-8444-555555555555";
const SUBSTRATE_UUID_SUBMISSION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

// ---------------------------------------------------------------------------
// Fixtures · the substrate-id "poison" pattern
// ---------------------------------------------------------------------------

const QUEST_ID = Schema.decodeSync(QuestId)("quest-mongolian-001");
const NPC_ID = Schema.decodeSync(NpcId)("mongolian");
const WALLET = Schema.decodeSync(PlayerWallet)(`0x${"a".repeat(40)}`);
const DISCORD = Schema.decodeSync(DiscordId)("123456789012345678");
const VERIFIED: PlayerIdentity = {
  type: "verified",
  wallet: WALLET,
  discord_id: DISCORD,
};

const baseState = (phase: QuestState["phase"], overrides: Partial<QuestState> = {}): QuestState => ({
  quest_id: QUEST_ID,
  player: VERIFIED,
  npc_id: NPC_ID,
  phase,
  trace_id: SUBSTRATE_UUID_TRACE,
  contract_version: "1.0.0",
  ...overrides,
});

const poisonSubmission: SubmissionEnvelope = {
  submission_id: SUBSTRATE_UUID_SUBMISSION as SubmissionEnvelope["submission_id"],
  trace_id: SUBSTRATE_UUID_TRACE,
  quest_id: QUEST_ID,
  player: VERIFIED,
  text_response: "stillness",
  submitted_at: "2026-05-04T17:30:00.000Z",
  contract_version: "1.0.0",
};

const poisonVerdict: QuestVerdict = {
  submission_id: SUBSTRATE_UUID_SUBMISSION,
  trace_id: SUBSTRATE_UUID_TRACE,
  status: "APPROVED",
  confidence: 0.84,
  narrative: "the steppe nods · your stillness was the point",
  curator_voice_quote: "the steppe nods",
  construct_slug: "mongolian-grader",
  graded_at: "2026-05-04T17:45:00.000Z",
  contract_version: "1.0.0",
};

// ---------------------------------------------------------------------------
// Field-level guards: verdict snapshot does NOT carry submission_id / trace_id
// ---------------------------------------------------------------------------

describe("CMP-boundary substrate-id leak · QuestState.verdict snapshot", () => {
  it("judge() does NOT embed submission_id into state.verdict", async () => {
    const state = baseState("submitted");
    const next = await Effect.runPromise(judge(state, poisonVerdict));

    const verdictBlob = JSON.stringify(next.verdict ?? {});
    expect(verdictBlob).not.toContain(SUBSTRATE_UUID_SUBMISSION);
  });

  it("judge() does NOT embed trace_id into state.verdict", async () => {
    const state = baseState("submitted");
    const next = await Effect.runPromise(judge(state, poisonVerdict));

    const verdictBlob = JSON.stringify(next.verdict ?? {});
    expect(verdictBlob).not.toContain(SUBSTRATE_UUID_TRACE);
  });

  it("judge() preserves narrative + curator_voice_quote (the user-facing fields)", async () => {
    const state = baseState("submitted");
    const next = await Effect.runPromise(judge(state, poisonVerdict));

    expect(next.verdict?.narrative).toBe(poisonVerdict.narrative);
    expect(next.verdict?.curator_voice_quote).toBe(poisonVerdict.curator_voice_quote);
  });

  it("verdict snapshot keys do NOT include submission_id or trace_id", async () => {
    const state = baseState("submitted");
    const next = await Effect.runPromise(judge(state, poisonVerdict));
    const keys = Object.keys(next.verdict ?? {});
    expect(keys).not.toContain("submission_id");
    expect(keys).not.toContain("trace_id");
  });
});

// ---------------------------------------------------------------------------
// User-facing field shape: no UUID-shape leak in narrative or curator_quote
// ---------------------------------------------------------------------------

describe("CMP-boundary substrate-id leak · narrative drift signatures", () => {
  it("narrative passed through judge() never matches UUID drift signature", async () => {
    const state = baseState("submitted");
    // Verdict with a clean narrative · we assert the engine doesn't add IDs.
    const next = await Effect.runPromise(judge(state, poisonVerdict));
    const narrative = next.verdict?.narrative ?? "";
    expect(narrative).not.toMatch(UUID_V4_RE);
    expect(narrative).not.toMatch(ULID_RE);
  });

  it("curator_voice_quote passed through judge() never matches UUID drift signature", async () => {
    const state = baseState("submitted");
    const next = await Effect.runPromise(judge(state, poisonVerdict));
    const quote = next.verdict?.curator_voice_quote ?? "";
    expect(quote).not.toMatch(UUID_V4_RE);
    expect(quote).not.toMatch(ULID_RE);
    expect(quote).not.toMatch(LONG_HEX_RE);
  });
});

// ---------------------------------------------------------------------------
// Tagged-error fields are SAFE to carry quest_id (user-facing slug, not UUID)
// but MUST NOT carry trace_id or submission_id substrings.
// ---------------------------------------------------------------------------

describe("CMP-boundary substrate-id leak · tagged errors", () => {
  it("InvalidPhaseTransitionError fields do NOT carry trace_id or submission_id", async () => {
    const state = baseState("browsing"); // wrong phase for submit
    const result = await Effect.runPromise(
      Effect.either(submit(state, poisonSubmission)),
    );
    if (result._tag !== "Left") throw new Error("expected failure");
    const errBlob = JSON.stringify({
      _tag: result.left._tag,
      ...(result.left as unknown as Record<string, unknown>),
    });
    expect(errBlob).not.toContain(SUBSTRATE_UUID_TRACE);
    expect(errBlob).not.toContain(SUBSTRATE_UUID_SUBMISSION);
    // quest_id IS present and user-facing safe (kebab-case slug, not UUID).
    expect(errBlob).toContain("quest-mongolian-001");
  });
});

// ---------------------------------------------------------------------------
// Whole-pipeline drift sweep · run an end-to-end transition chain · assert
// that final state and verdict snapshot don't carry UUID-shaped substrings
// in any field that's slated for renderer consumption.
// ---------------------------------------------------------------------------

describe("CMP-boundary substrate-id leak · end-to-end pipeline", () => {
  it("verdict snapshot fields don't contain UUID drift signatures after full pipeline", async () => {
    const initial = baseState("browsing");
    const program = Effect.gen(function* () {
      const accepted = yield* accept(initial);
      const submitted = yield* submit(accepted, poisonSubmission);
      const judged = yield* judge(submitted, poisonVerdict);
      const completed = yield* finalize(judged, "https://example.com/badge.png");
      return completed;
    });

    const final = await Effect.runPromise(program);
    // verdict snapshot is the ONLY user-facing struct in QuestState.
    // Top-level fields like trace_id ARE telemetry and ARE expected to carry
    // UUID-shape · the renderer's CMP transform 7 strips them at the boundary.
    const verdictBlob = JSON.stringify(final.verdict ?? {});
    expect(verdictBlob).not.toMatch(UUID_V4_RE);
    expect(verdictBlob).not.toMatch(ULID_RE);

    // Sanity: badge_uri is a URL not an opaque ID.
    expect(final.badge_uri).toBe("https://example.com/badge.png");
  });
});
