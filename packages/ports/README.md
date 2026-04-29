# packages/ports — typed quest interfaces

Hexagonal architecture ports. These are the interfaces consumers depend on; impls (the cubquests-dashboard backend, future per-world impls) bind to them. Per [[contracts-as-bridges]]: the port is the bridge that survives impl rotation.

## Status: scaffolded; content extraction pending

Source: `world-sprawl/cubquests-dashboard/actions/` + `world-sprawl/cubquests-dashboard/lib/quest-loader.ts`. Per `../../docs/EXTRACTION-MAP.md`.

## Planned contents (post-extraction)

| file | purpose |
|---|---|
| `quest-engine.ts` (`IQuestEngine`) | publishQuest, queryQuests, completeQuest, getQuestById |
| `badge-service.ts` (`IBadgeService`) | issueBadge, queryUserBadges, getBadgesForQuest |
| `raffle-service.ts` (`IRaffleService`) | createRaffle, addEntry, drawWinners, getRaffleEntries |
| `quest-loader.ts` | Quest discovery + filtering API |
| `index.ts` | Public exports |

## Why split from the protocol

- `protocol/` is wire format (data shapes — JSON Schema, Zod, NATS subjects)
- `ports/` is method signatures (the API consumers call)

A port references protocol types but adds method semantics (parameters, return shapes, error modes). Splitting lets a future Rust quest-engine impl satisfy the port without inheriting TypeScript-specific bindings.

## Consumers

- `world-sprawl/cubquests-dashboard/` (current impl)
- `freeside-quests/packages/adapters/quest-engine-client.ts` (typed client adapter — wraps HTTP)
- World consumers (Purupuru Year 2, Honey Port, Mibera) via the adapter
- `freeside-ruggy` for digest queries via mcp-tools
