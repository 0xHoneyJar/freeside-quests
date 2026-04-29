# INTENT — why freeside-quests exists

Operator-extraction directive captured across vault doctrine 2026-04-25 → 2026-04-28:

> *"CubQuests is evolving from standalone app → shared **Questing module** (POAPs, missions, bonding badges) that any world can import. See `world-module-integration.md` § Questing. Purupuru Year 2 wants it; Honey Port likely wants it; Mibera plausibly wants it. The CubQuests dashboard remains the canonical operator surface; the engine becomes `src/lib/questing/` library. Decision surfaced in `loa-freeside#174` § 3."*
> — vault `wiki/entities/world-registry.md`

> *"Engine extracts to questing module any world imports; dashboard remains canonical operator surface."*
> — vault `wiki/concepts/freeside-deceptively-simple-register.md`

Scaffolded 2026-04-28 as instance-4 of [[freeside-modules-as-installables]] (siblings: `freeside-worlds`, `freeside-score`, `freeside-filesystem`, `freeside-ruggy`).

## Why this module exists

CubQuests (`cubquests.com`, Next.js + Railway PG, high Umami traffic) has been the org's quest-engagement workhorse — POAPs, missions, raffles, badges, completion tracking, partner integrations. Built so THJ wouldn't have to use other people's tools (per Eileen, [[buyer-layer-thesis]]).

Multiple worlds want what CubQuests does:
- **Purupuru Year 2**: questing as part of the bond loop (per [[purupuru-world-vs-the-game]] depth rooms — quests live in the world)
- **Honey Port** (evolved hub-interface per `0xHoneyJar/hub-interface#24`): quests as the engagement surface
- **Mibera** (plausible): collection-aware quest tracking
- **Future worlds**: declarative `compose_with: freeside-quests` in world-manifest.yaml

Without a shared module, each world reimplements its own quest engine + JSON shape + reward/badge schemas. Inevitable inline duplication; cross-world consumers (ruggy, dashboards) need bespoke per-world fetches.

This module's job: **own the schemas + engine + agent surface; let worlds COMPOSE quests without owning quest infrastructure**.

## Why "quests" (plural)

Per [[loa-org-naming-conventions]]: plural slugs mark "registry of multiple subjects". A `freeside-quests` install gives a world MANY quest definitions, badges, raffles. Mirrors `freeside-worlds` (registry of multiple worlds).

## Why now

Per [[freeside-modules-as-installables]] extraction-trigger doctrine: extract when 2+ external repos consume. CubQuests has at least 3 declared consumers (Purupuru, Honey Port, Mibera). Hits the threshold cleanly.

## Scope candidates (LOCKED enough to start; details land per package)

- **`packages/protocol/`** — quest definition schemas (Zod + JSON Schema), completion criteria types, badge schemas, raffle schemas, branded types (QuestId, BadgeId, CompletionEventId).
- **`packages/ports/`** — `IQuestEngine` (publishQuest, queryQuests, completeQuest), `IBadgeService` (issueBadge, queryUserBadges), `IRaffleService` (createRaffle, drawWinners). Hexagonal port pattern.
- **`packages/adapters/`** — typed HTTP client over the engine API; Subsquid indexer config template (per-world deploy config); webhook verifier for quest-completion events.
- **`packages/mcp-tools/`** — MCP tool specs for agent runtimes: `getUserBadges`, `getActiveQuests`, `getQuestCompletions`, `getRaffleEntries`, `partnerQuestStatus`. Consumed by ruggy and future Freeside dashboard MCP.
- **`packages/engine/`** — headless quest engine library extracted from `cubquests-dashboard/actions/` (publishQuest logic) + `cubquests/apps/frontend/lib/` (quest validation + claim flows). Stateful where needed; framework-agnostic.
- **`packages/ui/`** — React components: `<QuestCard>`, `<BadgeShelf>`, `<CompletionCeremony>`, `<RaffleEntryButton>`, `<ProgressBar>`. Per-world apps skin via design tokens; this is the shape, not the chrome.

## What's deferred to extraction cycles

- Whether the engine is purely TS (CubQuests is) or also includes WASM hot-paths
- Whether the indexer is per-world or shared (current CubQuests has one Subsquid; multi-world likely needs per-world)
- Migration plan for in-flight CubQuests quests (data stays in CubQuests DB; freeside-quests-typed access via ports)
- POAP minting integration (chain-specific; might land in adapters or stay external)
- Race conditions: what happens when a quest mutates schema while consumers cache the old version

## Why STUB packages today (not full extraction)

Per [[freeside-modules-as-installables]]: design with module boundaries from day 1; let extraction follow when it earns the cycles. The repo + package skeleton lands; concrete extraction happens when:
- Purupuru Year 2 cycle starts (forces the questing wire)
- Or Honey Port wants quests live (same wire, different consumer)
- Or someone proposes a quest schema change in CubQuests that would benefit from being centralized first

Until then: scaffold + EXTRACTION-MAP make the next move legible.

## Reference

- Sister doctrine: [[freeside-modules-as-installables]] — the family this module belongs to
- Source code today: `world-sprawl/cubquests/` + `world-sprawl/cubquests-dashboard/`
- Strategic frame: [[buyer-layer-thesis]] — quests are part of the buyer-layer activation surface
- Issue context: [loa-freeside#174 §3](https://github.com/0xHoneyJar/loa-freeside/issues/174) (Purupuru multi-app provisioning naming Quest as a Module)
- World registry: `vault/wiki/entities/world-registry.md` § "CubQuests (evolving → Questing module)"
