# packages/protocol — sealed quest schemas

Wire-format contracts for quest definitions, completion criteria, badges, raffles, and quest-completion events. Bridges every `freeside-quests` consumer (worlds, ruggy, dashboards, future MCP wrappers) to a single coherent vocabulary.

## Status: scaffolded; content extraction pending

Source: `world-sprawl/cubquests/` + `world-sprawl/cubquests-dashboard/`. Per `../../docs/EXTRACTION-MAP.md`.

## Planned contents (post-extraction)

| file | purpose |
|---|---|
| `quest.schema.json` + `.ts` (Zod) | Quest definition — title, description, completion criteria, rewards, partner attribution, dates |
| `completion-criteria.schema.json` + `.ts` | Typed completion criteria (held NFT count, trait match, social action, onchain action, partner-specific) |
| `badge.schema.json` + `.ts` | Badge definition + issuance criteria + visual asset references |
| `raffle.schema.json` + `.ts` | Raffle entry + draw + winner schemas |
| `event.schema.json` + `.ts` | Quest-completion NATS event shape (`quests.completion.{world}.{quest_id}`). NEW. |
| `webhook-payload.schema.json` + `.ts` | HMAC-signed webhook payload format. NEW. |
| `types.ts` | Branded TS types — QuestId, BadgeId, CompletionEventId, PartnerSlug |
| `VERSIONING.md` | Schema governance (imported from loa-constructs). Enum-locked, additive-only minors. |

## Governance

Same as `freeside-worlds/packages/protocol/VERSIONING.md` — imported verbatim from `loa-constructs/.claude/schemas/VERSIONING.md`. Major bumps require new file + migration plan + stable `$id`.

## Consumers (post-extraction)

- `freeside-quests/packages/ports/` — type ports off these schemas
- `freeside-quests/packages/adapters/quest-engine-client.ts` — validates over wire
- `freeside-quests/packages/mcp-tools/` — agent-callable surface
- `world-sprawl/cubquests-dashboard/` — impl validates inputs/outputs against these
- `0xHoneyJar/freeside-ruggy` — consumes event schemas + completion fan-out
- `freeside-worlds` — world manifests reference compose_with: freeside-quests
- (future worlds) Purupuru Year 2, Honey Port, Mibera — typed access via ports
