# packages/adapters — typed clients + indexer template

Concrete impls binding `ports/` to specific transports (HTTP, NATS, webhook, Subsquid). The port is the contract; the adapter is one fulfillment.

## Status: scaffolded; content extraction pending

Source: `world-sprawl/cubquests/packages/indexer/` (Subsquid) + `world-sprawl/cubquests-dashboard/lib/api-middleware.ts`. Per `../../docs/EXTRACTION-MAP.md`.

## Planned contents (post-extraction)

| file | purpose |
|---|---|
| `quest-engine-client.ts` | HTTP-over-fetch typed client. Implements `IQuestEngine`. |
| `nats-publisher.ts` | NATS publisher for quest-completion events. NEW per cross-module composition with `freeside-score`. |
| `webhook-verifier.ts` | HMAC verification for inbound CubQuests webhooks. |
| `indexer-template/` | Subsquid indexer config TEMPLATE — parameterized for chain + contracts. Per-world deployment instantiates. |

## Why adapters live here (not in cubquests)

The HTTP adapter wraps the wire-format. It's the same code every TS consumer needs (Purupuru, Honey Port, Mibera, ruggy, dashboards). Living here means:
- One canonical typed client; no consumer rolls their own fetch
- Bumps follow `protocol/` + `ports/` versions (not cubquests-dashboard deploy version)
- Future Rust quest-service can ship its own adapter (`packages/adapters-rust/`) without affecting TS consumers

## Indexer template

CubQuests today has one Subsquid indexer (`world-sprawl/cubquests/packages/indexer/`). Multi-world likely needs per-world deployments (different chains, different contracts). The TEMPLATE in this package is the parameterized starting point; each world's infra clones + parameterizes for its own deploy.

## Consumers

- World repos (purupuru, honey-port, mibera) consuming `IQuestEngine`
- `freeside-ruggy` for outbound queries (in addition to MCP)
- `world-sprawl/cubquests-dashboard/` post-extraction (rewires to import from `freeside-quests/adapters`)
