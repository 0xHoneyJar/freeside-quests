# Integration Path — staged cutover with CubQuests

CubQuests today owns the quest engine + schemas inside `world-sprawl/cubquests/` + `world-sprawl/cubquests-dashboard/` (per `EXTRACTION-MAP.md` source paths). This doc describes the staged cutover so consumers don't break + the cubquests.com dashboard stays live.

Per [[freeside-modules-as-installables]]: two stages, soft then hard.

## Stage 1 — Soft cutover (this scaffold)

**Goal**: this repo exists with the right shape; ready to receive extracted code.

**State**:
- ✅ Repo scaffolded (you're reading this)
- ✅ Package layout matches the eventual extraction targets
- ✅ EXTRACTION-MAP names every source path
- ✅ Doctrine landed at [[freeside-modules-as-installables]]
- ✅ Cross-world consumer interest declared (Purupuru Year 2, Honey Port, Mibera plausibly)
- ⏳ Code remains in `cubquests` + `cubquests-dashboard`; consumers continue to call the existing CubQuests REST API

**Why stage 1 first**: scaffolding the destination repo BEFORE extraction lets the operator + cubquests team align on shape. No code moves; no consumers break. The repo sits ready.

## Stage 2 — Hard cutover (per-package, when coordinated)

**Goal**: code physically extracts; cubquests-dashboard consumes via package import (or git URL fetch — pattern TBD per doctrine); other worlds (Purupuru, Honey Port) install the same package.

### Per-package sequence

For each row in `EXTRACTION-MAP.md`:

1. **Coordinate window**: confirm CubQuests team has no in-flight work touching the package being extracted.
2. **Move + tests**: copy the source code into `freeside-quests/packages/<target>/`. Bring tests. Run them in this repo until green.
3. **Cross-repo import in cubquests-dashboard**: rewire cubquests-dashboard to import from `freeside-quests/packages/<target>/` (via npm package OR git path OR file fetch — depends on install pattern decided by then).
4. **Delete cubquests-dashboard copy**: only after consumers verified. Keep a comment-stub pointing at `freeside-quests` for one cycle.
5. **Verify**: cubquests.com still builds + deploys; quest publishing still works; ruggy MCP tools resolve; no tooling regression.

### Order of extraction (lowest risk → highest)

| order | package | risk | gate |
|---|---|---|---|
| 1 | `packages/protocol/` (Zod schemas + JSON Schema) | low — schema-only, no impl coupling | coordination window |
| 2 | `packages/ports/` (IQuestEngine + IBadgeService + IRaffleService interfaces) | low — interface only | after package 1 stable |
| 3 | `packages/mcp-tools/` (MCP tool specs) | low — net-new content; ruggy consumer ready | parallel with 1-2 |
| 4 | `packages/adapters/quest-engine-client.ts` (typed HTTP client) | medium — consumers (worlds) rewire imports | after ports extracted |
| 5 | `packages/engine/` (headless quest logic) | high — the load-bearing extraction | requires CubQuests cycle window |
| 6 | `packages/ui/` (React components) | medium — design-system coupling per world | last; needs taste alignment per world |

### Net-new (not extraction)

- Webhook payload schemas (`packages/protocol/webhook-payload.schema.json`)
- NATS event schemas (`packages/protocol/event.schema.json`)
- MCP tool manifest + tools (`packages/mcp-tools/`)

## What cubquests + cubquests-dashboard look like after cutover

```
world-sprawl/cubquests/                  (turborepo)
├── apps/
│   ├── frontend/        ← rewires to `import * from 'freeside-quests/engine'`
│   ├── creator-docs/    (unchanged)
│   └── user-docs/       (unchanged)
├── packages/
│   ├── indexer/         ← rewires to import from `freeside-quests/adapters/indexer-template/`
│   ├── ui/              ← deprecated; consumers import from `freeside-quests/ui` instead
│   └── (eslint-config, typescript-config — unchanged)
└── ...

world-sprawl/cubquests-dashboard/        (Next.js — STAYS as canonical operator surface)
├── app/                 (chrome, unchanged)
├── components/          (chrome-specific, unchanged)
├── lib/                 ← rewires to `import * from 'freeside-quests/{engine,ports,adapters}'`
├── actions/             ← becomes thin wrappers over `freeside-quests/engine/`
└── ...
```

## What changes for downstream consumers

| consumer | before | after |
|---|---|---|
| `cubquests-dashboard/actions/*` | inline TS + Supabase | `import { publishQuest } from 'freeside-quests/engine'` |
| `world-sprawl/cubquests/apps/frontend` | inline `lib/` for claim flows | `import { claim } from 'freeside-quests/engine/claim'` |
| `world-purupuru` (when Year 2 lands quests) | (no quest substrate) | `import { IQuestEngine, type Quest } from 'freeside-quests/ports'` + `compose_with: freeside-quests` in world-manifest |
| `0xHoneyJar/freeside-ruggy` | (no quest queries today) | imports `mcp-tools/manifest.json` to register quest-aware tools |
| Any future world | declarative `compose_with: freeside-quests` | typed access via `freeside-quests/ports`; no inline duplication |

## Phase 2 — runtime quest registry (later)

Once Phase 2 of [[freeside-worlds]] registry lands (DB-backed runtime queries), the Freeside dashboard can render:
- Per-world quest aggregate (active/total, completions, top performers)
- Cross-world quest discovery (find all quests across THJ ecosystem)
- Per-partner quest performance

That requires `freeside-quests/packages/registry/` (parallel to `freeside-worlds/packages/registry/`). Defer until cross-world quest discovery becomes a real product surface (post-MVP).

## Open coordination items

- [ ] Confirm CubQuests team is OK with extraction direction (operator already declared this in vault; confirm with whoever does daily CubQuests work)
- [ ] Decide install mechanism (npm vs git-url vs hybrid) per [[freeside-modules-as-installables]] — affects how downstream `import` paths look
- [ ] Confirm cubquests-dashboard rename plan — does it get a `freeside-` prefix in the future (e.g., `freeside-cubquests-dashboard` if it's a freeside-* operator-facing dashboard) or stay as `cubquests-dashboard` (per-tenant tooling)?
- [ ] First consumer to migrate post-extraction (suggested: Purupuru Year 2 — net-new use; no legacy import path to break)
- [ ] Database schema migration plan: cubquests Postgres stays as the source-of-truth; module ports describe access surface; how does a world that wants its OWN quest DB swap in a different impl behind the same port?
