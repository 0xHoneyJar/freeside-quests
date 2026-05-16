# Agent Working Memory (NOTES.md)

> This file persists agent context across sessions and compaction cycles.
> Updated automatically by agents. Manual edits are preserved.

## Active Sub-Goals
<!-- Current objectives being pursued -->

## Discovered Technical Debt
<!-- Issues found during implementation that need future attention -->

## Blockers & Dependencies
<!-- External factors affecting progress -->

## Session Continuity
<!-- Key context to restore on next session -->
| Timestamp | Agent | Summary |
|-----------|-------|---------|
| 2026-05-16T02:30Z | /implement sprint-1 cycle-1 | Landed T1.1 (workspace tooling: biome + vitest + Effect ^3.12 + scoped lint to ACVP paths) and T1.2 (9 branded types + 30 constructor-discipline tests · all 175/175 green · 0 regressions). T1.3–T1.20 remain. Resume via /simstim --resume picks up at /run sprint-1 cycle 2 → starts at T1.3 Activity schema. Report: grimoires/loa/a2a/sprint-1/reviewer.md |
| 2026-05-16T02:43Z | /implement sprint-1 cycle-2 | Landed T1.3 (Activity supertype FR-1 + CL-Activity-1..4) and T1.4 (WorldDefined seam D19 + §9.1 namespace governance with substrate-enforced reserved prefixes). +31 activity tests · 206/206 total green · 0 regressions. Surfaced Effect.Schema API drift: `Schema.TaggedEnum` removed in 3.x · using `Schema.Union(Schema.TaggedStruct(...))` instead. T1.5–T1.20 remain (16 tasks). Resume via /simstim --resume picks up at T1.5 ActivityStep. |

## Decision Log
<!-- Major decisions with rationale -->
| 2026-05-16 | T1.1 biome scope | Limited biome `files.includes` to NEW ACVP code paths (`packages/protocol/src/branded/`, `events/`, `preimage/`, `encoding/`, `golden-vectors/`, plus `packages/ports/src/`, `packages/adapters/src/in-memory/`, `packages/mcp-tools/src/`, `packages/engine/src/{compose,lifecycle,retry}.ts`, and `packages/**/tests/`). Legacy `quest*.ts` files (still consumed by discord-renderer) stay un-linted until a future migration cycle. Avoids 72-error lint failure on first run while keeping new code under strict formatter+linter discipline. |
| 2026-05-16 | Partial-completion handoff | `/run sprint-1` Phase 7 will not finish 20 tasks in a single Claude turn (~1 day at autonomous pace per sprint estimate). Cycle 1 ships T1.1+T1.2 as a coherent foundation slice. Subsequent run-mode cycles iterate on T1.3+. Reviewer.md is structured as a partial-completion handoff (tasks_completed + tasks_remaining in frontmatter) so cycle 2 picks up cleanly. |
| 2026-05-16 | PartitionKey scope union | Adopted IMP-016 RESOLVED shape (`{scope: 'activity'|'identity'|'world'|'event-type'|'composite', value: string}`) over freeform string brand. T1.20 will refine composite-value validation on top of this base shape. |
| 2026-05-16 | MintIntentId lives here | Forward-compat brand for the freeside-mint sibling module (ships post-acvp-modules-genesis). Keeping the brand local avoids a cross-module dependency in event payloads while preserving type safety. Authority over MintIntent OBJECTS remains in freeside-mint when it lands. |
| 2026-05-16 | Effect.Schema TaggedEnum substitution | PRD code samples use `Schema.TaggedEnum({...})` — that constructor was removed in Effect 3.x (installed version 3.21.2 has only TaggedStruct + TaggedClass + TaggedError + TaggedRequest). Sealed unions in 3.x build from `Schema.Union(Schema.TaggedStruct("Tag", {...}), ...)`. Cycle-2 applies this pattern to ActivityKind (5 variants) + ActivityReward (None stub). T1.5 (VerificationMethod · 6 variants) and T1.6 (ActivityReward · 5 variants + RewardState) MUST follow the same idiom. PRD remains correct as a specification; ImplementationS layer translates the syntax. |
| 2026-05-16 | ActivityStep / ActivityReward stubs | Cycle-2 ships minimal scaffolds for ActivityStep (step_id + order only) and ActivityReward (None variant only) to unblock T1.3 Activity supertype. Full T1.5 (description + sealed VerificationMethod with 6 variants + required boolean) and T1.6 (Token / NFT / Badge / Raffle / Composite variants + RewardState async machine + Fix-A1 nonce policy + BigInt-as-DecimalValue per D14) land in subsequent cycles. Replacement is additive: adding fields to a Schema.Struct keeps existing decodes valid as long as additions are non-required-or-defaulted, and the TaggedStruct discriminator pattern is preserved. |
| 2026-05-16 | WorldDefinedKindId substrate enforcement | T1.4 implements §9.1 namespace governance via 3 layered filters: (1) `Schema.maxLength(64)`, (2) `Schema.pattern(/^[a-z0-9_-]+:[a-z0-9_-]+$/)` for the `<world>:<kind>` shape, (3) `Schema.filter` rejecting suffixes starting with reserved prefixes (`freeside-`, `loa-`, `core-`). The reserved-prefix list is exported as `RESERVED_KIND_PREFIXES` so worlds + downstream tooling can mirror the substrate rule. Test `activity.test.ts:257-265` parametrically asserts each reserved prefix is rejected. |
