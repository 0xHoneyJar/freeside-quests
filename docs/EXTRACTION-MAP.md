# Extraction Map — what to pull from CubQuests

The schemas, ports, engine logic, and UI this repo will own currently live across `world-sprawl/cubquests/` (turborepo with apps/frontend, packages/indexer, packages/ui) + `world-sprawl/cubquests-dashboard/` (Next.js operator dashboard).

Per [[freeside-modules-as-installables]] §"What this means for `loa-freeside`": staged cutover (soft → hard). This map is the per-file plan.

**Coordination required before physical extraction.** This map is reference; the cutover is a separate cycle.

## packages/protocol/

| from (world-sprawl) | to (freeside-quests) | notes |
|---|---|---|
| `cubquests-dashboard/database.types.ts` | `packages/protocol/types.ts` | TS-generated from Supabase schema today; extract the typed surface (Quest, Badge, Raffle, Completion, etc.). Keep DB-impl-specific types OUT. |
| `cubquests-dashboard/actions/publish-quest-direct.ts:input-shape` | `packages/protocol/quest.schema.json` + `.ts` (Zod) | The quest definition shape — title, description, completion criteria, rewards, partner attribution, dates. |
| `cubquests-dashboard/actions/check-creator-badges.ts:badge-shape` | `packages/protocol/badge.schema.json` + `.ts` | Badge definition + issuance criteria. |
| `cubquests-dashboard/lib/raffles/` (any schema files) | `packages/protocol/raffle.schema.json` + `.ts` | Raffle entry + draw schemas. |
| `cubquests/apps/frontend/src/app/api/*/route.ts:input/output schemas` | `packages/protocol/event.schema.json` (NEW) | Quest-completion event shape, NATS subjects (`quests.completion.{world}.{quest_id}`). Net-new — events not formalized in CubQuests today. |
| (NEW) | `packages/protocol/VERSIONING.md` | Imported verbatim from loa-constructs (enum-locked schema_version, additive-only minors). |

## packages/ports/

| from (world-sprawl) | to (freeside-quests) | notes |
|---|---|---|
| `cubquests-dashboard/actions/publish-quest-direct.ts` + `publish-quest-to-quests-table.ts` | `packages/ports/quest-engine.ts` (`IQuestEngine`) | The publish/query/complete API surface. Extract method signatures only — impl stays in cubquests. |
| `cubquests-dashboard/actions/check-creator-badges.ts` + badges-related actions | `packages/ports/badge-service.ts` (`IBadgeService`) | issueBadge, queryUserBadges, getBadgesForQuest. |
| `cubquests-dashboard/lib/raffles/` actions | `packages/ports/raffle-service.ts` (`IRaffleService`) | createRaffle, addEntry, drawWinners. |
| `cubquests-dashboard/lib/quest-loader.ts` | `packages/ports/quest-loader.ts` | Quest discovery + filtering API surface. |
| (NEW) | `packages/ports/index.ts` | Public exports. |

## packages/adapters/

| from (world-sprawl) | to (freeside-quests) | notes |
|---|---|---|
| (concrete impls of cubquests-dashboard actions) | `packages/adapters/quest-engine-client.ts` | Typed HTTP client over the existing CubQuests REST API. Implements `IQuestEngine`. |
| `cubquests/packages/indexer/` (Subsquid config) | `packages/adapters/indexer-template/` | Subsquid indexer config TEMPLATE (per-world deployment instantiates). Generic + parameterized for chain + contracts. |
| `cubquests-dashboard/lib/api-middleware.ts` | `packages/adapters/webhook-verifier.ts` | HMAC-signed webhook payload verification. |

## packages/mcp-tools/

| from (world-sprawl) | to (freeside-quests) | notes |
|---|---|---|
| (doesn't exist yet) | `packages/mcp-tools/manifest.json` + `tools/*.json` | NEW — MCP tool specs for agent-callable quest queries. Authored fresh; ruggy + future Freeside dashboard MCP consume. |

Tools to author:
- `tools/get-active-quests.json` — list active quests, optionally filtered by world / partner
- `tools/get-user-badges.json` — list badges held by an address
- `tools/get-quest-completions.json` — completion events for a quest, paginated
- `tools/get-raffle-entries.json` — entries for a raffle
- `tools/partner-quest-status.json` — partner-specific quest aggregate

## packages/engine/

| from (world-sprawl) | to (freeside-quests) | notes |
|---|---|---|
| `cubquests-dashboard/actions/publish-quest-direct.ts:logic` | `packages/engine/publish.ts` | The quest-publishing flow (validate, persist, emit event). Extract logic; keep DB binding swappable via injected port. |
| `cubquests-dashboard/actions/cached-queries.ts` | `packages/engine/queries.ts` | Cached quest queries; cache layer parameterized. |
| `cubquests-dashboard/lib/quest-loader.ts:logic` | `packages/engine/loader.ts` | Quest discovery + filtering logic. |
| `cubquests-dashboard/lib/generate-input.ts` + `generate-json.ts` | `packages/engine/generators.ts` | Helper utilities for quest authoring. |
| `cubquests-dashboard/actions/find-json-differences.ts` | `packages/engine/diff.ts` | Quest-version diff utility. |
| `cubquests/apps/frontend/lib/` | `packages/engine/claim/` | Consumer-side claim flow logic (validate completion, mint badge). |

## packages/ui/

| from (world-sprawl) | to (freeside-quests) | notes |
|---|---|---|
| `cubquests/packages/ui/src/` | `packages/ui/src/` | The shared component library, generalized. |
| `cubquests/apps/frontend/src/components/quest-card/` | `packages/ui/src/quest-card/` | If extractable from frontend. |
| `cubquests-dashboard/components/badges/` | `packages/ui/src/badges/` | Badge display components. |
| (extract during cycle) | `packages/ui/src/{progress, completion-ceremony, raffle-entry}/` | Identify which components are world-skinnable vs CubQuests-chrome-specific. |

## What does NOT extract

- The CubQuests operator dashboard surface — `apps/cubquests-dashboard/app/` chrome (the Next.js pages + server-rendered admin UI). STAYS as canonical CM surface.
- Quest CONTENT (the actual quests authored on cubquests.com) — stays in CubQuests' Postgres DB. freeside-quests provides typed access; doesn't migrate the data.
- Partner-specific business logic (`partner-data`, `partners`, `partner-special-access` in dashboard `actions/`) — partner integrations stay in CubQuests.
- Privy authentication wire (`cubquests-dashboard/lib/privy.ts`) — auth is per-world Identity Component, not module concern.
- S3 client (`cubquests-dashboard/lib/s3-client.ts`) — file storage is `freeside-filesystem` territory, not `freeside-quests`.
- Subsquid db config (`cubquests/packages/indexer/db/`) — deploy infra, per-world.

## How to use this map

1. Coordinate with whoever owns CubQuests today (operator + cubquests team) — confirm extraction window.
2. For each row above, follow the staged process in `INTEGRATION-PATH.md`.
3. Update `IDEMPOTENCY-REPORT.md` (TBD) per package as cutover lands.
4. Verify CubQuests dashboard still builds + deploys after each package extraction (consumers rewire imports).
