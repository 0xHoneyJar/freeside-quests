# freeside-quests — agent instructions

This is a freeside-* installable module: **quest-based engagement** (POAPs, missions, badges, raffles, completion tracking). Six packages: `protocol/` (sealed schemas), `ports/` (TS interfaces), `adapters/` (typed clients + Subsquid indexer), `mcp-tools/` (agent surface), `engine/` (headless quest logic), `ui/` (shared React components).

Source-of-truth for the QUEST CONTENT and the operator-facing dashboard remains [CubQuests](https://cubquests.com) (`world-sprawl/cubquests/` + `world-sprawl/cubquests-dashboard/`). This repo extracts the **engine** + **schemas** + **agent surface** for cross-world consumption.

## When loaded

Load this CLAUDE.md when:
- Operator extracts code from CubQuests → freeside-quests packages (per `docs/EXTRACTION-MAP.md`)
- Operator authors a new world that wants quests (declares `compose_with: freeside-quests` in world-manifest.yaml)
- Operator wires the agent surface (ruggy queries quest data via `packages/mcp-tools/`)
- Operator extends the protocol with new quest types or badge categories

## Hard rules

- **Schemas live here, content stays at cubquests.com.** Quest DEFINITIONS (the JSON shape, completion criteria, badge schemas) are this module's job. Quest CONTENT (the actual quests creators authored) stays in CubQuests' DB. Per [[contracts-as-bridges]].
- **Schema governance imported from loa-constructs.** Enum-locked `schema_version`, additive-only minor bumps, major bumps require migration plan + new file + stable `$id` (per `packages/protocol/VERSIONING.md`).
- **Don't extract code without coordination.** Today's engine logic lives in `world-sprawl/cubquests-dashboard/actions/` + `world-sprawl/cubquests/apps/frontend/lib/`. Extraction is a coordination move with whoever owns CubQuests; see `docs/INTEGRATION-PATH.md`.
- **Naming follows attachment-prefix doctrine.** `freeside-quests` is plural — mirrors `freeside-worlds` (registry of multiple subjects). Per [[loa-org-naming-conventions]].

## Composition

- `world-sprawl/cubquests/` (apps/frontend, packages/indexer, packages/ui) — current home of engine + indexer + UI
- `world-sprawl/cubquests-dashboard/` — operator-facing dashboard (STAYS as canonical CM surface)
- `0xHoneyJar/freeside-worlds` — world manifests reference compose_with: freeside-quests
- `0xHoneyJar/freeside-score` — quest completion can emit score events (cross-module composition)
- `0xHoneyJar/freeside-filesystem` — quest assets (badge images, raffle artwork) live here
- `0xHoneyJar/freeside-ruggy` — consumes mcp-tools for quest-aware fan-out

## What this repo does NOT own

- The CubQuests operator dashboard (`apps/cubquests-dashboard/` — stays as canonical CM surface)
- World-specific quest content (authored quests live in each world's quest DB)
- World-specific quest UI skinning (each world skins to its own design system)
- Subsquid deployment (per-world deployment lives in each world's infra)
- POAP minting on-chain (lives in each world's contracts)

## References

- Doctrine: `vault/wiki/concepts/freeside-modules-as-installables.md`
- World registry entry: `vault/wiki/entities/world-registry.md` § "CubQuests (evolving → Questing module)"
- Sister doctrine: `vault/wiki/concepts/freeside-deceptively-simple-register.md` (in-house DNA bridge)
- Issue context: [loa-freeside#174 §3](https://github.com/0xHoneyJar/loa-freeside/issues/174) (Purupuru multi-app provisioning naming Quest as a Module)
- Sibling: `0xHoneyJar/freeside-worlds`, `0xHoneyJar/freeside-score`, `0xHoneyJar/freeside-filesystem`
