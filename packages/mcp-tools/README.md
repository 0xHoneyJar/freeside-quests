# packages/mcp-tools — MCP tool specs for quest queries

Agent-callable surface. MCP tool manifests + per-tool JSON schemas wrapping `freeside-quests/ports/` for consumption by agent runtimes (ruggy bot, future Freeside dashboard MCP, third-party agents).

## Status: scaffolded; content NEW (not extraction)

CubQuests today doesn't expose an MCP surface. Authored from scratch as part of this repo's v0.

## Planned contents

| file | purpose |
|---|---|
| `manifest.json` | MCP server manifest (name, description, tools array) |
| `tools/get-active-quests.json` | List active quests, filterable by world / partner / completion status |
| `tools/get-user-badges.json` | List badges held by an address (cross-world if requested) |
| `tools/get-quest-completions.json` | Completion events for a quest, paginated, optionally time-bounded |
| `tools/get-raffle-entries.json` | Entries for a raffle |
| `tools/partner-quest-status.json` | Partner-specific quest aggregate (CubQuests has rich partner integration) |
| `tools/leaderboard.json` | Top performers per quest / per world / per partner |

## Pattern

Each tool spec follows MCP convention: name + description + inputSchema (JSON Schema) + outputSchema (references `../protocol/` for shape).

## Consumers

- `0xHoneyJar/freeside-ruggy` — primary MCP client; persona-bot uses these tools to surface quest activity in Discord digests
- Future Freeside dashboard MCP wrapper (per [[freeside-as-subway]] §"MCP wrapper")
- Third-party agents that want to query THJ quest state (operator-authorized via API key)

## Composition

- Wraps `freeside-quests/packages/ports/` over MCP transport
- Validates I/O against `freeside-quests/packages/protocol/` schemas
- Registered in ruggy's MCP server config as a remote tool source — alongside `freeside-score/packages/mcp-tools/`
