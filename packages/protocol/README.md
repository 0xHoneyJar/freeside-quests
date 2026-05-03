# packages/protocol — sealed quest schemas

Wire-format contracts for quest engagement. Bridges every `freeside-quests` consumer (worlds, ruggy, dashboards, future MCP wrappers) to a single coherent vocabulary.

Contract version: **1.0.0** · authority: Effect Schema · sealed.

## Current contents

Cycle 2026-05-03 substrate-integration (instance-1) lands the substrate-step submission/verdict pair — the over-the-wire envelope for substrate-graded activity steps in cubquests-interface.

| export | purpose |
|---|---|
| `SubstrateStepSubmission` | Gateway → Kafka → construct. Discriminated payload (essay/url/structured), trace correlation, lowercased EVM wallet, contract-version stamping. |
| `SubstrateStepVerdict` | Construct → Kafka → resolution listener. Status (`APPROVED` / `REJECTED` / `NEEDS_HUMAN`), confidence on [0,1], human-readable reasoning, optional per-construct dimensions. |
| `SubstrateStepPayload` | Discriminated union of supported submission shapes. Additive minor bumps. |
| `VerdictStatus` | Literal union — terminal states + human-routing. |
| `SUBSTRATE_STEP_CONTRACT_VERSION` | `"1.0.0"` — semver string for wire-format compatibility checks. |

Three boundaries validate against these schemas:

1. `freeside-quests/apps/api` gateway — validates inbound submission, wraps in Hounfour `CompletionRequest`, publishes to Kafka.
2. Substrate construct (e.g. `0xHoneyJar/construct-lore-essay-grader`) — validates narrower per-construct input; emits verdict back into the result topic.
3. `freeside-quests/apps/worker` resolution listener — validates inbound verdict before any DB update, badge issuance, or Discord ping.

## Doctrine

Substrate-graded steps are a primitive of the substrate-construct convention. See `~/vault/wiki/concepts/substrate-mental-model-for-product-builders.md` — the operator authors lore + grading instructions; the construct enforces them. The protocol package owns the seam.

## Future shapes

Source: `world-sprawl/cubquests/` + `world-sprawl/cubquests-dashboard/`. Per `../../docs/EXTRACTION-MAP.md`. Not yet shipped:

| file | purpose |
|---|---|
| `quest.schema.ts` | Quest definition — title, description, completion criteria, rewards, partner attribution, dates |
| `completion-criteria.schema.ts` | Typed completion criteria (held NFT count, trait match, social action, onchain action, partner-specific) |
| `badge.schema.ts` | Badge definition + issuance criteria + visual asset references |
| `raffle.schema.ts` | Raffle entry + draw + winner schemas |
| `event.schema.ts` | Quest-completion NATS event shape (`quests.completion.{world}.{quest_id}`). NEW. |
| `webhook-payload.schema.ts` | HMAC-signed webhook payload format. NEW. |
| `types.ts` | Branded TS types — QuestId, BadgeId, CompletionEventId, PartnerSlug |

## Governance

Same as `freeside-worlds/packages/protocol/VERSIONING.md` — imported verbatim from `loa-constructs/.claude/schemas/VERSIONING.md`. Enum-locked, additive-only minors. Major bumps require new file + migration plan + stable `$id`.

## Consumers

- `freeside-quests/packages/engine` — substrate-step dispatch validates against these schemas
- `freeside-quests/packages/ports/` — type ports off these schemas (post-extraction)
- `freeside-quests/packages/adapters/quest-engine-client.ts` — validates over wire (post-extraction)
- `freeside-quests/packages/mcp-tools/` — agent-callable surface (post-extraction)
- `world-sprawl/cubquests-dashboard/` — impl validates inputs/outputs against these (post-extraction)
- `0xHoneyJar/freeside-ruggy` — consumes event schemas + completion fan-out (post-extraction)
- `freeside-worlds` — world manifests reference `compose_with: freeside-quests`
- (future worlds) Purupuru Year 2, Honey Port, Mibera — typed access via ports
