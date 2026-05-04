/**
 * Cross-pack Tag identity test — architect lock A2 + SDD §10.2.
 *
 * Asserts that the QuestStatePort Tag's string identity is EXACTLY
 * `"@freeside-quests/QuestStatePort"`. This string is the cross-pack
 * resolution key per Effect's `Context.GenericTag` contract.
 *
 * When loa-finn#157 lands, the substrate-runtime adapter (in a separate
 * package) MUST declare `Context.GenericTag<...>("@freeside-quests/QuestStatePort")`
 * with the exact same string. This test guards against accidental rename.
 *
 * Cycle-Q · 2026-05-04 · sprint-2 ENGINE+PERSIST.
 */

import { describe, expect, it } from "vitest";
import { Context } from "effect";

import {
  QuestStatePort,
  QUEST_STATE_PORT_TAG_IDENTITY,
} from "../../persistence/port.js";

// ---------------------------------------------------------------------------
// Identity string contract
// ---------------------------------------------------------------------------

describe("QuestStatePort cross-pack identity", () => {
  it("exposes EXACT string '@freeside-quests/QuestStatePort' (architect lock A2)", () => {
    expect(QUEST_STATE_PORT_TAG_IDENTITY).toBe("@freeside-quests/QuestStatePort");
  });

  it("Tag.key matches the identity string (Effect cross-pack resolution contract)", () => {
    // `Context.Tag` exposes `.key` as the identity string used by Effect to
    // resolve services across module boundaries. Asserting `.key === IDENTITY`
    // proves the Tag was constructed with the canonical string.
    expect(QuestStatePort.key).toBe(QUEST_STATE_PORT_TAG_IDENTITY);
  });

  it("Tag.key is exactly '@freeside-quests/QuestStatePort' (literal match)", () => {
    // Defense-in-depth · two tests that fail independently if either constant
    // drifts. Cycle-2 substrate-runtime adapter MUST reference this literal.
    expect(QuestStatePort.key).toBe("@freeside-quests/QuestStatePort");
  });

  it("identity string starts with package scope and uses no whitespace", () => {
    // Drift signature guard: catches accidental rename to '@freeside-quests / QuestStatePort'
    // or `@freeside_quests/...` etc.
    expect(QUEST_STATE_PORT_TAG_IDENTITY).toMatch(/^@freeside-quests\/QuestStatePort$/);
  });

  it("a hand-constructed Tag with the same string resolves as the same Tag", () => {
    // This proves the cross-pack mechanism: declare a Tag in this test file
    // (simulating a different package) using the exact string · Effect's
    // internal resolution treats it as the same Tag identity.
    const externalTag = Context.GenericTag<QuestStatePort>(
      "@freeside-quests/QuestStatePort",
    );
    expect(externalTag.key).toBe(QuestStatePort.key);
  });

  it("a Context.Tag-class-form declaration with the same string also resolves as the same Tag (per bridgebuilder iter-1 F-low-2)", () => {
    // Bridgebuilder iter-1 LOW finding: defend against shape-drift across
    // declaration forms. Effect supports both `Context.GenericTag(...)` and
    // the `class FooTag extends Context.Tag(...)<FooTag, FooShape>()` form
    // (the latter is what loa-finn#157 sprint-3 ModelRunner uses).
    //
    // The cross-pack identity contract is the STRING — regardless of which
    // declaration form a future package picks. This test simulates the
    // class-form path and asserts identity equality.
    class ExternalQuestStatePortTag extends Context.Tag(
      "@freeside-quests/QuestStatePort",
    )<ExternalQuestStatePortTag, QuestStatePort>() {}
    expect(ExternalQuestStatePortTag.key).toBe(QuestStatePort.key);
    expect(ExternalQuestStatePortTag.key).toBe(QUEST_STATE_PORT_TAG_IDENTITY);
  });
});
