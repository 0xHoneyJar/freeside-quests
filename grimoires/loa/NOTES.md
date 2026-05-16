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

## Decision Log
<!-- Major decisions with rationale -->
| 2026-05-16 | T1.1 biome scope | Limited biome `files.includes` to NEW ACVP code paths (`packages/protocol/src/branded/`, `events/`, `preimage/`, `encoding/`, `golden-vectors/`, plus `packages/ports/src/`, `packages/adapters/src/in-memory/`, `packages/mcp-tools/src/`, `packages/engine/src/{compose,lifecycle,retry}.ts`, and `packages/**/tests/`). Legacy `quest*.ts` files (still consumed by discord-renderer) stay un-linted until a future migration cycle. Avoids 72-error lint failure on first run while keeping new code under strict formatter+linter discipline. |
| 2026-05-16 | Partial-completion handoff | `/run sprint-1` Phase 7 will not finish 20 tasks in a single Claude turn (~1 day at autonomous pace per sprint estimate). Cycle 1 ships T1.1+T1.2 as a coherent foundation slice. Subsequent run-mode cycles iterate on T1.3+. Reviewer.md is structured as a partial-completion handoff (tasks_completed + tasks_remaining in frontmatter) so cycle 2 picks up cleanly. |
| 2026-05-16 | PartitionKey scope union | Adopted IMP-016 RESOLVED shape (`{scope: 'activity'|'identity'|'world'|'event-type'|'composite', value: string}`) over freeform string brand. T1.20 will refine composite-value validation on top of this base shape. |
| 2026-05-16 | MintIntentId lives here | Forward-compat brand for the freeside-mint sibling module (ships post-acvp-modules-genesis). Keeping the brand local avoids a cross-module dependency in event payloads while preserving type safety. Authority over MintIntent OBJECTS remains in freeside-mint when it lands. |
