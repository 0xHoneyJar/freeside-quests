/**
 * cmp-boundary.test.ts — drift-signature regression suite.
 *
 * Per SDD §5.3 + architect lock A3 (the 7th transform · NEW this cycle):
 * asserts that NO substrate ID — UUID, wallet hex, backend `@g<id>`,
 * trace_id, submission_id, raw Discord ID — ever escapes the boundary
 * into user-visible Discord output.
 *
 * Test strategy: poison every fixture with telemetry-shaped strings and
 * assert the renderers + transforms scrub them before serialization.
 *
 * Cycle-Q · 2026-05-04 · sprint-3 BOT WIRING.
 */

import { describe, expect, it } from "vitest";
import type {
  BadgeArtifact,
  PlayerIdentity,
  Quest,
  QuestState,
  QuestVerdict,
} from "@freeside-quests/protocol";
import { renderBadgeReveal } from "../src/cmp-boundary/render-badge-reveal.js";
import { renderQuestDetail } from "../src/cmp-boundary/render-quest-detail.js";
import { renderQuestList } from "../src/cmp-boundary/render-quest-list.js";
import { renderVerdict } from "../src/cmp-boundary/render-verdict.js";
import {
  filterTelemetryFromOutput,
  npcIdToDisplayName,
  phaseToNarrative,
  questIdToTitle,
  transforms,
  verdictToNarrative,
  walletToHandle,
  type AuthCheck,
  type CharacterRegistry,
  type CuratorVoiceProfile,
} from "../src/cmp-boundary/transforms.js";

// ---------------------------------------------------------------------------
// Drift-signature regex (the assertion · used in every test)
// ---------------------------------------------------------------------------

const UUID_RE =
  /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/;
const WALLET_RE = /\b0x[0-9a-fA-F]{40}\b/;
const BACKEND_ANCHOR_RE = /(?<!\w)@g\d+\b/;

const POISON_UUID = "11111111-2222-3333-4444-555555555555";
const POISON_TRACE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const POISON_SUBMISSION_ID = "12345678-1234-1234-1234-123456789012";
const POISON_WALLET = "0x1234567890abcdef1234567890abcdef12345678";
const POISON_BACKEND_ANCHOR = "@g507";
const POISON_BARE_DISCORD_ID = "987654321098765432";

const assertNoLeak = (text: string): void => {
  expect(text).not.toMatch(UUID_RE);
  expect(text).not.toMatch(WALLET_RE);
  expect(text).not.toMatch(BACKEND_ANCHOR_RE);
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fixtureQuest: Quest = {
  quest_id: POISON_UUID as Quest["quest_id"],
  npc_pointer: "mongolian" as Quest["npc_pointer"],
  world_slug: "mibera" as Quest["world_slug"],
  title: "Mark the Fire",
  prompt:
    "tell the steppe what you carry. what flame do you bring to the gathering?",
  rubric_pointer: {
    type: "codex_ref",
    construct_slug: "construct-mongolian",
    cell_id: "TODO_TRACK_A",
  },
  badge_spec: {
    family_id: "mongolian-petroglyph" as Quest["badge_spec"]["family_id"],
    display_name: "The Steppe's Mark",
    prompt_seed: "petroglyph carved on basalt · ochre + soot",
    format_hint: "webp",
  },
  published_at: "2026-05-04T12:00:00.000Z",
  step_count: 1,
  contract_version: "1.0.0",
};

const fixtureRegistry: CharacterRegistry = {
  resolveDisplayName: (npc_id) =>
    npc_id === "mongolian" ? "Munkh" : undefined,
};

const fixtureVoice: CuratorVoiceProfile = {
  judged_approved: "the steppe nods",
  judged_rejected: "the wind turns away",
  completed: "the mark is set",
  failed: "the path closes for now",
};

const fixtureState: QuestState = {
  quest_id: POISON_UUID as QuestState["quest_id"],
  player: {
    type: "anon",
    discord_id: POISON_BARE_DISCORD_ID as PlayerIdentity["discord_id"],
  },
  npc_id: "mongolian" as QuestState["npc_id"],
  phase: "judged",
  accepted_at: "2026-05-04T12:00:00Z",
  submitted_at: "2026-05-04T12:01:00Z",
  judged_at: "2026-05-04T12:02:00Z",
  verdict: {
    status: "APPROVED",
    confidence: 0.92,
    narrative:
      "your fire reaches the witnesses. the steppe takes your mark and remembers.",
  },
  trace_id: POISON_TRACE_ID,
  contract_version: "1.0.0",
};

const fixtureVerdict: QuestVerdict = {
  submission_id: POISON_SUBMISSION_ID,
  trace_id: POISON_TRACE_ID,
  status: "APPROVED",
  confidence: 0.92,
  narrative:
    "your fire reaches the witnesses. the steppe takes your mark and remembers.",
  curator_voice_quote: "the bone whistles in the wind",
  construct_slug: "construct-mongolian",
  graded_at: "2026-05-04T12:02:00Z",
  contract_version: "1.0.0",
};

const fixtureBadge: BadgeArtifact = {
  uri: "https://assets.0xhoneyjar.xyz/badges/mongolian/mark-of-fire.webp" as BadgeArtifact["uri"],
  generated_format: "webp",
  prompt_seed_used: "petroglyph carved on basalt · ochre + soot",
  issued_at: "2026-05-04T12:03:00Z",
};

// ---------------------------------------------------------------------------
// Transform 1 · questIdToTitle
// ---------------------------------------------------------------------------

describe("CMP-boundary · T1 questIdToTitle", () => {
  it("returns the title, not the UUID-shaped quest_id", () => {
    expect(questIdToTitle(fixtureQuest)).toBe("Mark the Fire");
  });

  it("never returns a UUID-shaped string", () => {
    expect(questIdToTitle(fixtureQuest)).not.toMatch(UUID_RE);
  });
});

// ---------------------------------------------------------------------------
// Transform 2 · npcIdToDisplayName
// ---------------------------------------------------------------------------

describe("CMP-boundary · T2 npcIdToDisplayName", () => {
  it("resolves slug → display name", () => {
    expect(npcIdToDisplayName("mongolian", fixtureRegistry)).toBe("Munkh");
  });

  it("falls back to slug (kebab-case · NEVER backend anchor) when registry empty", () => {
    const empty: CharacterRegistry = { resolveDisplayName: () => undefined };
    const out = npcIdToDisplayName("mongolian", empty);
    expect(out).toBe("mongolian");
    expect(out).not.toMatch(BACKEND_ANCHOR_RE);
  });
});

// ---------------------------------------------------------------------------
// Transform 3 · walletToHandle
// ---------------------------------------------------------------------------

describe("CMP-boundary · T3 walletToHandle", () => {
  it("returns the curator-resolved handle when AuthCheck supplies one", () => {
    const auth: AuthCheck = { is_verified: true, display_handle: "@munkh" };
    const player: PlayerIdentity = {
      type: "verified",
      wallet: POISON_WALLET as PlayerIdentity["wallet"],
      discord_id: POISON_BARE_DISCORD_ID as PlayerIdentity["discord_id"],
    };
    const out = walletToHandle(player, auth);
    expect(out).toBe("@munkh");
    expect(out).not.toMatch(WALLET_RE);
  });

  it("falls back to Discord mention syntax · raw wallet NEVER escapes", () => {
    const auth: AuthCheck = { is_verified: false };
    const player: PlayerIdentity = {
      type: "verified",
      wallet: POISON_WALLET as PlayerIdentity["wallet"],
      discord_id: POISON_BARE_DISCORD_ID as PlayerIdentity["discord_id"],
    };
    const out = walletToHandle(player, auth);
    expect(out).toBe(`<@${POISON_BARE_DISCORD_ID}>`);
    expect(out).not.toMatch(WALLET_RE);
  });
});

// ---------------------------------------------------------------------------
// Transform 4 · phaseToNarrative
// ---------------------------------------------------------------------------

describe("CMP-boundary · T4 phaseToNarrative", () => {
  it("returns curator cadence for APPROVED verdict, NEVER the enum", () => {
    const out = phaseToNarrative(fixtureState, fixtureVoice);
    expect(out).toBe("the steppe nods");
    expect(out).not.toContain("APPROVED");
    expect(out).not.toContain("judged");
  });

  it("returns curator cadence for REJECTED verdict", () => {
    const rejected = {
      ...fixtureState,
      verdict: { ...fixtureState.verdict!, status: "REJECTED" as const },
    };
    const out = phaseToNarrative(rejected, fixtureVoice);
    expect(out).toBe("the wind turns away");
    expect(out).not.toContain("REJECTED");
  });

  it("falls back to substrate cadence when voice doesn't supply cadence", () => {
    const empty: CuratorVoiceProfile = {};
    const out = phaseToNarrative(fixtureState, empty);
    // never returns the phase enum
    expect(out).not.toBe("judged");
    expect(out).not.toContain("APPROVED");
  });
});

// ---------------------------------------------------------------------------
// Transform 5 · verdictToNarrative
// ---------------------------------------------------------------------------

describe("CMP-boundary · T5 verdictToNarrative", () => {
  it("returns ONLY the narrative · NEVER status enum or confidence numeral", () => {
    const out = verdictToNarrative(fixtureVerdict);
    expect(out).toBe(fixtureVerdict.narrative);
    expect(out).not.toContain("APPROVED");
    expect(out).not.toContain("0.92");
    expect(out).not.toContain("PASS");
    expect(out).not.toContain("FAIL");
  });
});

// ---------------------------------------------------------------------------
// Transform 7 · filterTelemetryFromOutput (the load-bearing scrub)
// ---------------------------------------------------------------------------

describe("CMP-boundary · T7 filterTelemetryFromOutput", () => {
  it("strips UUID-shaped substrings", () => {
    const poisoned = `the trace is ${POISON_TRACE_ID} which carries ${POISON_UUID}`;
    const out = filterTelemetryFromOutput(poisoned);
    expect(out).not.toMatch(UUID_RE);
  });

  it("strips wallet hex substrings", () => {
    const poisoned = `the wallet is ${POISON_WALLET} which is verified`;
    const out = filterTelemetryFromOutput(poisoned);
    expect(out).not.toMatch(WALLET_RE);
  });

  it("strips backend `@g<id>` annotations", () => {
    const poisoned = `the ancestor is ${POISON_BACKEND_ANCHOR} but the name is Munkh`;
    const out = filterTelemetryFromOutput(poisoned);
    expect(out).not.toMatch(BACKEND_ANCHOR_RE);
    // curator-authored name preserved
    expect(out).toContain("Munkh");
  });

  it("strips bare 17-20 digit Discord IDs but PRESERVES <@id> mention syntax", () => {
    const bare = `user ${POISON_BARE_DISCORD_ID} accepted`;
    expect(filterTelemetryFromOutput(bare)).not.toContain(POISON_BARE_DISCORD_ID);
    const mention = `<@${POISON_BARE_DISCORD_ID}> accepted the quest`;
    const mentionOut = filterTelemetryFromOutput(mention);
    // mention syntax preserved (Discord renders as name)
    expect(mentionOut).toContain(`<@${POISON_BARE_DISCORD_ID}>`);
  });

  it("returns input unchanged when no telemetry present", () => {
    const clean = "the steppe takes your mark and remembers";
    expect(filterTelemetryFromOutput(clean)).toBe(clean);
  });

  it("handles empty string", () => {
    expect(filterTelemetryFromOutput("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Aggregate surface — `transforms` exports all 7
// ---------------------------------------------------------------------------

describe("CMP-boundary · transforms aggregate surface", () => {
  it("exports all 7 named transforms", () => {
    expect(typeof transforms.questIdToTitle).toBe("function");
    expect(typeof transforms.npcIdToDisplayName).toBe("function");
    expect(typeof transforms.walletToHandle).toBe("function");
    expect(typeof transforms.phaseToNarrative).toBe("function");
    expect(typeof transforms.verdictToNarrative).toBe("function");
    expect(typeof transforms.badgeUriToVariant).toBe("function");
    expect(typeof transforms.filterTelemetryFromOutput).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Renderer integration — drift signature regression on output shapes
// ---------------------------------------------------------------------------

describe("CMP-boundary · renderQuestList integration", () => {
  it("returns ≤5 embeds even when input is larger", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...fixtureQuest,
      quest_id: `quest-${i}` as Quest["quest_id"],
      title: `Quest ${i}`,
    }));
    const out = renderQuestList(many);
    expect(out.length).toBeLessThanOrEqual(5);
  });

  it("never leaks UUID/wallet/backend-anchor in title or description", () => {
    // poison the title + prompt with telemetry shapes
    const poisoned = {
      ...fixtureQuest,
      title: `Mark the Fire ${POISON_UUID}`,
      prompt: `tell the steppe ${POISON_WALLET} what you carry ${POISON_BACKEND_ANCHOR}`,
    };
    const [embed] = renderQuestList([poisoned]);
    assertNoLeak(JSON.stringify(embed));
  });
});

describe("CMP-boundary · renderQuestDetail integration", () => {
  it("emits embed + Accept + Skip action row · custom_id carries quest_id slug", () => {
    const out = renderQuestDetail(fixtureQuest, fixtureRegistry);
    expect(out.embed.title).toBe("Mark the Fire");
    expect(out.components).toHaveLength(1);
    expect(out.components[0].components).toHaveLength(2);
    const acceptBtn = out.components[0].components[0];
    expect("custom_id" in acceptBtn ? acceptBtn.custom_id : "").toContain(
      "quest_accept_",
    );
  });

  it("never leaks telemetry across the full embed JSON", () => {
    const poisoned = {
      ...fixtureQuest,
      title: `Mark the Fire ${POISON_UUID}`,
      prompt: `${POISON_WALLET} the steppe waits ${POISON_BACKEND_ANCHOR}`,
    };
    const out = renderQuestDetail(poisoned, fixtureRegistry);
    assertNoLeak(JSON.stringify(out.embed));
  });

  it("truncates body to ≤180 words", () => {
    const longPrompt = Array.from({ length: 250 }, (_, i) => `word${i}`).join(
      " ",
    );
    const longQuest = { ...fixtureQuest, prompt: longPrompt };
    const out = renderQuestDetail(longQuest, fixtureRegistry);
    const body = out.embed.description ?? "";
    const wordCount = body.replace(/…/g, "").trim().split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(181); // 180 + ellipsis token
  });
});

describe("CMP-boundary · renderVerdict integration", () => {
  it("title is curator cadence, body is curator narrative", () => {
    const out = renderVerdict(fixtureState, fixtureVerdict, fixtureVoice);
    expect(out.title).toBe("the steppe nods");
    expect(out.description).toContain("the steppe takes your mark");
  });

  it("never serializes status enum or numeric confidence", () => {
    const out = renderVerdict(fixtureState, fixtureVerdict, fixtureVoice);
    const json = JSON.stringify(out);
    expect(json).not.toContain("APPROVED");
    expect(json).not.toContain("0.92");
  });

  it("never leaks substrate IDs even when poisoned", () => {
    const poisonedVerdict: QuestVerdict = {
      ...fixtureVerdict,
      narrative: `your fire ${POISON_UUID} reaches ${POISON_WALLET} witnesses`,
      curator_voice_quote: `the bone ${POISON_BACKEND_ANCHOR} whistles`,
    };
    const out = renderVerdict(fixtureState, poisonedVerdict, fixtureVoice);
    assertNoLeak(JSON.stringify(out));
  });
});

describe("CMP-boundary · renderBadgeReveal integration", () => {
  it("title is curator cadence, image carries badge variant URI", () => {
    const completed: QuestState = { ...fixtureState, phase: "completed" };
    const out = renderBadgeReveal(completed, fixtureBadge, fixtureVoice);
    expect(out.title).toBe("the mark is set");
    expect(out.image?.url).toBe(fixtureBadge.uri);
  });

  it("never leaks substrate IDs in the descriptor", () => {
    const completed: QuestState = { ...fixtureState, phase: "completed" };
    const out = renderBadgeReveal(completed, fixtureBadge, fixtureVoice);
    assertNoLeak(JSON.stringify(out));
  });
});

// ---------------------------------------------------------------------------
// End-to-end drift signature: every renderer's JSON output is clean
// ---------------------------------------------------------------------------

describe("CMP-boundary · end-to-end drift signature regression", () => {
  it("no renderer's JSON output contains UUID/wallet/backend-anchor when poisoned at every input field", () => {
    const poisoned: Quest = {
      ...fixtureQuest,
      quest_id: POISON_UUID as Quest["quest_id"],
      title: `${POISON_UUID} fire`,
      prompt: `${POISON_WALLET} ${POISON_BACKEND_ANCHOR} steppe`,
    };
    const poisonedState: QuestState = {
      ...fixtureState,
      quest_id: POISON_UUID as QuestState["quest_id"],
      trace_id: POISON_TRACE_ID,
      phase: "judged",
    };
    const poisonedVerdict: QuestVerdict = {
      ...fixtureVerdict,
      submission_id: POISON_SUBMISSION_ID,
      trace_id: POISON_TRACE_ID,
      narrative: `${POISON_UUID} fire ${POISON_WALLET}`,
      curator_voice_quote: `${POISON_BACKEND_ANCHOR}`,
    };

    const list = JSON.stringify(renderQuestList([poisoned]));
    const detail = JSON.stringify(renderQuestDetail(poisoned, fixtureRegistry));
    const verdict = JSON.stringify(
      renderVerdict(poisonedState, poisonedVerdict, fixtureVoice),
    );
    const badge = JSON.stringify(
      renderBadgeReveal(
        { ...poisonedState, phase: "completed" },
        fixtureBadge,
        fixtureVoice,
      ),
    );

    for (const out of [list, detail, verdict, badge]) {
      assertNoLeak(out);
    }
  });
});
