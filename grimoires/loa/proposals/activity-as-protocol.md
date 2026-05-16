---
type: vault-doctrine-candidate
authored_in: freeside-activities/grimoires/loa/proposals (sprint-3 T3.6)
date: 2026-05-16
status: candidate (pending operator promotion to ~/vault/wiki/concepts/)
target_path: ~/vault/wiki/concepts/activity-as-protocol.md
use_label: background_only (until operator promotes)
related_doctrine:
  - "[[agentic-cryptographically-verifiable-protocol]]"  (parent)
  - "[[freeside-modules-as-installables]]"  (the family)
  - "[[contracts-as-bridges]]"  (the bridge that survives adapter rotation)
  - "[[chat-medium-presentation-boundary]]"  (CMP-convention sibling)
  - "[[mibera-as-npc]]"  (two-tier: construct judges · substrate verifies)
sources_of_record:
  - cubquests-interface/AGENTS.md §1 (Activities-Unification design discovery)
  - cubquests-interface/lib/process-quests.ts (production verification surface)
  - cubquests-interface/lib/blockchain/badge-merkle.ts (badge-claim shape)
  - cubquests-interface/lib/resource-raffles/scheduler.ts (raffle-entry shape)
  - compass/packages/peripheral-events/src/world-event.ts (typed-port discipline)
  - freeside-activities/grimoires/loa/{prd,sdd,sprint}.md (acvp-modules-genesis cycle artifacts)
  - freeside-activities/packages/protocol/src/activity/{Activity,ActivityKind,ActivityStep,ActivityReward}.ts
---

# Activity as Protocol

> *The Activity supertype crystallization · the moment we made the Activities-Unification
> design discovery explicit in the substrate boundary.*

## The crystallization

CubQuests discovered, after years of production, that **Quest and Mission are the same thing — both are Activities**. The crystallization is captured in `cubquests-interface/AGENTS.md §1`:

```typescript
type Activity = {
  kind: 'quest' | 'mission';   // Only difference
  slug: string;
  steps: ActivityStep[];
  reward: ActivityReward;
};

// Database: Single source of truth
user_activity_progress {
  activity_id: string;
  period_key: string | null;   // null = quest, "2025-W42" = mission
  status: 'not_started' | 'in_progress' | 'completed';
}
```

`period_key` is the time-axis discriminant. ONE table · ONE API · ONE pipeline.

`freeside-activities` extends the crystallization: **BadgeClaim and RaffleEntry are ALSO Activity kinds**. The cubquests team didn't reach this leap because badges + raffles ship outside the unified-activity pipeline today. The substrate makes the leap explicit at the schema boundary.

## What this doctrine names

The "Activity-as-protocol" pattern is the **substrate** posture toward participation records:

1. Identity-bound participation has ONE supertype (`Activity`) and N discriminants (`ActivityKind` sealed union)
2. The supertype carries:
   - **id** (branded · stable across renames)
   - **kind** (sealed-union tag · routes to per-kind verification + reward semantics)
   - **period_key** (time-axis discriminant · null for one-shot · ISO-week for recurring · custom for season-bound)
   - **steps[]** (sequence of `ActivityStep` · each step carries a sealed `VerificationMethod`)
   - **reward** (sealed-union reward shape · what the world hands the identity on completion)
   - **completion_event_schema** ($id-pinned · canonical-preimage hashed · hash-chained)
3. **Each Activity instance commits to a $id-pinned schema at creation time.** The schema_version IS the contract.
4. **No Activity transitions state without an emitted CompletionEvent.** This is the event-completeness invariant (CL-Event-1).
5. **Every reward emission traces to a completion-event hash.** Hash-chain continuity (CL-Event-2).

## The 4 built-in Activity kinds

| kind | period model | reward typical | verification typical |
|---|---|---|---|
| `quest` | one-shot · `period_key: null` | badge · token · cosmetic · external | manual-curator · signed-memo-tx · on-chain-event |
| `mission` | recurring · `period_key: ISO-week` | same as quest | same as quest |
| `badge-claim` | one-shot · `period_key: null` | badge-mint only | merkle-proof (off-chain snapshot → on-chain claim) |
| `raffle-entry` | season-bound · `period_key: custom-cycle` | external (raffle ticket grant) | partner-api · webhook-hmac |

The 4 are MINIMAL by design — adding a 5th built-in requires `/architect` cycle. Worlds extending the kind set use the `WorldDefined` seam (`<world>:<kind>` form · substrate-enforced size + nesting bounds).

## ACVP-7-mapping

This doctrine's mapping to the 7 ACVP components:

| ACVP component | Activity-as-protocol manifestation |
|---|---|
| **Reality** | `Activity` supertype + `ActivityKind` sealed union models the identity-bound participation domain |
| **Contracts** | 4 typed ports (`ProgressPort` · `CompletionEventPort` · `RewardPort` · `IdentityResolverPort`) + `EventStoreContract` |
| **Schemas** | 7 event schemas extending `EventEnvelope` + per-event preimage schemas |
| **State machines** | `ActivityLifecycle` (5 states) + `RewardState` (3 states) + `ProgressLifecycleState` (per-identity 3 states) |
| **Events** | Every state mutation emits 1+ event · hash-chained via `source_event_hash` |
| **Hashes** | `event_id = SHA-256(canonical preimage via RFC 8785 JCS)` |
| **Tests** | 21 golden vectors + 18 adapter conformance scenarios + 8 cross-component invariants (CL-EventStore-1..7 + Fix-A1) |

## Presentation-name table (CMP-convention)

Per `[[chat-medium-presentation-boundary]]`: the substrate has NO user-visible strings. Each surface adapter translates substrate kinds to medium-appropriate copy. Example:

| Substrate | Discord | Telegram | Web | CLI |
|---|---|---|---|---|
| `quest` | 🎯 Quest | [Q] Quest | `<QuestCard/>` | QUEST |
| `mission` | ⚡ Mission | [M] Mission | `<MissionCard/>` | MISSION |
| `badge-claim` | 🏅 Badge | [B] Badge | `<BadgeCard/>` | BADGE |
| `raffle-entry` | 🎟️ Raffle | [R] Raffle | `<RaffleCard/>` | RAFFLE |

Worlds CAN supply their own presentation table for built-in kinds (cubquests calls quests "🎯 Cub Quests" · purupuru calls missions "🪙 Honey Missions"). The substrate doesn't care — that's the point.

## Why the substrate is narrow

The substrate ships ONLY:
- Schemas (sealed · cross-runtime decodable)
- Ports (Effect-returning · sealed errors · never throw)
- In-memory adapters (TEST/DEV fixtures · NOT production)
- Engine composition + state machines (lifecycle · retry)
- MCP agent surface (5 read-only tools)

It does NOT ship:
- Quest CONTENT (cubquests-interface stays canonical)
- Production adapters (postgres / convex / etc · world-built)
- Reward semantics (badge? token? cosmetic? — world decides via sealed reward variants)
- Verification authority (manual? merkle? signed? — world decides per-step)
- Presentation chrome (per-surface · per-medium · per-locale)

This narrowness is the substrate's value. Worlds compose authority over their own domain; the substrate guarantees cross-world hash identity + adapter conformance + agent readability.

## When to invoke this doctrine

Activate `[[activity-as-protocol]]` when:
- Proposing a new `ActivityKind` (does it pass the "is it truly cross-world?" gate?)
- Authoring a new world's `world-manifest.yaml` (which kinds does this world ship?)
- Auditing a cross-world data shape (does this shape need to be at substrate-level, or world-level?)
- Reasoning about hash-chain continuity (every reward MUST trace to a completion event)

## Empirical tail

This crystallization earned its keep via:

| Date | Evidence |
|---|---|
| 2025-Q1..Q4 | CubQuests production · ~10K+ users · "kind: 'quest' \| 'mission'" discriminant working in prod |
| 2026-04-28 | freeside-quests scaffold first names "Quest as a Module" (per loa-freeside#174 §3) |
| 2026-05-15 | acvp-modules-genesis kickoff makes the Activities-Unification leap explicit at substrate-level |
| 2026-05-16 | sprint-1 + sprint-2 ship the substrate · 648 workspace tests · audit APPROVED |

## When NOT to use this doctrine

The Activity supertype is for **participation records** — what an identity DID. It is NOT for:

- **Catalog items** (NFTs at rest · marketplace listings — see `freeside-mint` instead)
- **Scoring / leaderboards** (computed-over-activities · see `freeside-score`)
- **Persona delivery** (Discord bots · see `freeside-characters`)
- **Identity overlay** (wallet ↔ user resolution · see `freeside-auth`)

If you find yourself stretching Activity to model something that isn't an identity-bound participation record, STOP — it belongs in a different module.

## References

- Parent: `[[agentic-cryptographically-verifiable-protocol]]`
- Sibling: `[[freeside-modules-as-installables]]`
- Companion pattern: `[[merkle-snapshot-claim-pattern]]` (badge-claim verification shape)
- Companion pattern: `[[weighted-raffle-draw-pattern]]` (raffle-entry verification shape)
- Composition: `[[closed-loop-reward-mechanic]]` (questponzi-as-substrate · vault doctrine)
- Code: `freeside-activities/packages/protocol/src/activity/` (the canonical schemas)
- Cycle artifacts: `freeside-activities/grimoires/loa/{prd,sdd,sprint}.md`
- Operator surface (canonical): `cubquests-interface` (years of production · the source of the crystallization)
