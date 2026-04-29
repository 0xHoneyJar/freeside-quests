# freeside-quests

> The freeside-* installable module for **quest-based engagement** — POAPs, missions, badges, raffles, completion tracking. Sealed schemas + typed ports + agent surface + headless engine + shared UI. Worlds (purupuru, mibera, honey-port, future) compose with this; CubQuests dashboard remains the canonical operator-facing console.

This repo extracts the engine of [CubQuests](https://cubquests.com) into an installable module. Per [[freeside-modules-as-installables]] doctrine: each module owns sealed schemas + clean separation; consumers (worlds + dashboards + persona-bots) bind to the contracts, not the impl.

Doctrine: [`freeside-modules-as-installables`](https://github.com/0xHoneyJar/loa-hivemind/blob/main/wiki/concepts/freeside-modules-as-installables.md) — instance-4 of the freeside-* attachment-prefix family.

Operator-extraction directive (vault `world-registry`, `freeside-deceptively-simple-register`, loa-freeside#174):

> *"Engine extracts to questing module any world imports; dashboard remains canonical operator surface. Purupuru Year 2 wants it; Honey Port likely wants it; Mibera plausibly wants it."*

## The six packages

```
freeside-quests/
├── packages/
│   ├── protocol/    📐 sealed schemas — quest defs, completion criteria, badge shapes, raffle schemas
│   ├── ports/       🔌 IQuestEngine + IBadgeService + IRaffleService TS interfaces
│   ├── adapters/    🔁 typed clients (HTTP / Subsquid indexer) bound to ports
│   ├── mcp-tools/   🤖 agent-callable surface (ruggy: "who completed Quest X?", "what badges does wallet Y have?")
│   ├── engine/      ⚙️ headless quest-engine library (extracted from cubquests/apps/frontend/lib + cubquests-dashboard/actions)
│   └── ui/          🎨 shared React components for quest UIs (badges, progress, completion ceremonies)
└── docs/
    ├── INTENT.md            why this module exists, what it extracts, what stays
    ├── EXTRACTION-MAP.md    per-file source paths in world-sprawl/cubquests/ + cubquests-dashboard/
    └── INTEGRATION-PATH.md  staged cutover plan (CubQuests today → freeside-quests consumers)
```

| package | role | analogous to |
|---|---|---|
| `protocol/` | wire-format contracts (Draft 2020-12 JSON Schema + Zod) | `freeside-worlds/packages/protocol/`, `freeside-score/packages/protocol/` |
| `ports/` | TS interfaces consumers depend on; impls bind to these | hexagonal architecture port pattern, per [[contracts-as-bridges]] |
| `adapters/` | concrete impls of ports over wire (HTTP, Subsquid) | `freeside-score/packages/adapters/score-service-client.ts` |
| `mcp-tools/` | MCP tool specs for agent runtimes | `freeside-score/packages/mcp-tools/` |
| `engine/` | headless quest logic (the part of CubQuests that's NOT the dashboard chrome) | what `apps/cubquests-dashboard/actions/` becomes when extracted |
| `ui/` | shared React components | what `cubquests/packages/ui` becomes when promoted to cross-world |

## What lives here vs what stays at cubquests.com

| concern | here (`freeside-quests`) | stays at `cubquests.com` |
|---|---|---|
| Quest definition schema (JSON shape, Zod validators) | ✅ `packages/protocol/quest.schema.json` | — |
| Completion criteria types | ✅ `packages/protocol/completion-criteria.schema.json` | — |
| Badge / raffle schemas | ✅ `packages/protocol/badge.schema.json`, `raffle.schema.json` | — |
| `publishQuest`, `completeQuest`, `queryUserBadges` core logic | ✅ `packages/engine/` | impl runs against the engine library |
| Subsquid indexer config | ✅ `packages/adapters/indexer/` (template) | per-world deployment |
| MCP tool specs (agent queries) | ✅ `packages/mcp-tools/` | — |
| Operator dashboard (the cubquests.com chrome) | — | ✅ `apps/cubquests-dashboard/` STAYS as canonical CM surface |
| Quest CONTENT (the actual quests authored for cubquests.com) | — | ✅ stays in cubquests' DB |
| World-specific quest UI skinning | — | ✅ each world's app skins to its own design system |

## Why `freeside-quests` (plural slug)

Per [[loa-org-naming-conventions]] + [[freeside-modules-as-installables]]: plural slugs mark "registry of multiple subjects" (matches `freeside-worlds`). A single `freeside-quests` install gives a world MANY quest definitions to manage, badges to issue, raffles to run. Plural feels right at the module level.

## Family

| sibling | role |
|---|---|
| [`freeside-worlds`](https://github.com/0xHoneyJar/freeside-worlds) | world manifests + creator + protocol + registry. World manifests `compose_with: freeside-quests` to declare the world consumes this module. |
| [`freeside-score`](https://github.com/0xHoneyJar/freeside-score) | scoring schemas. Quest completion can EMIT score events (cross-module composition). |
| [`freeside-filesystem`](https://github.com/0xHoneyJar/freeside-filesystem) | file storage layout + CDN. Quest assets (badge images, raffle artwork) live here. |
| [`freeside-ruggy`](https://github.com/0xHoneyJar/freeside-ruggy) | persona-bot. Consumes mcp-tools to answer quest queries. |

## Status

- 2026-04-28 — repo scaffolded as instance-4 of the freeside-* installable-modules family
- 🛠 schemas + ports not yet extracted from cubquests/cubquests-dashboard — coordination + cycle work
- 📜 see `docs/EXTRACTION-MAP.md` for source paths
- 📋 see `docs/INTEGRATION-PATH.md` for the staged cutover plan
- 🚪 cubquests.com stays live as the canonical operator surface during + after extraction

## Consumer worlds (planned per vault `world-registry`)

| world | year planned | status |
|---|---|---|
| Purupuru | Year 2 | declared in vault |
| Honey Port (evolved hub-interface) | TBD | likely per loa-freeside#174 §3 |
| Mibera | plausible | open question |
| Future worlds | as needed | declarative `compose_with: freeside-quests` in their world-manifest.yaml |

## License

MIT.

---

🌱 instance-4. CubQuests was the first proof-of-life; freeside-quests is the substrate every future quest-shaped module rides.
