---
status: draft-r2-post-flatline
type: prd
cycle: acvp-modules-genesis
cycle_kickoff: ~/bonfire/grimoires/bonfire/specs/acvp-modules-genesis-kickoff-2026-05-15.md
module: freeside-activities
phase: simstim-phase-2-flatline-amendment
simstim_id: simstim-20260515-6a20a74b
created: 2026-05-15
revisions:
  - r1 (2026-05-15 PM): Phase 1 DISCOVERY initial draft · 705 lines
  - r2 (2026-05-15 PM · post-flatline-round-1): 25 findings triaged · 7 HC auto-integrated · 5/6 DISPUTED accepted · 4 CRITICAL blockers resolved in PRD · 8 HIGH blockers deferred to SDD with revisit policy
flatline_round_1:
  ran: 2026-05-15T01:10:39Z
  latency_seconds: 184
  cost_cents: 0
  cost_usd: 0
  models: [claude-opus-4-8, gpt-5.4-codex, gemini-3.0-pro]
  routing: cheval-headless (subscription auth · zero API quota burn)
  high_consensus: 7
  disputed: 6
  blockers: 12
  blockers_resolved_in_prd: 4 (CRITICAL · SKP-001 event_id · SKP-001 async-reward · SKP-003 event-store · SKP-005 identity)
  blockers_deferred_to_sdd: 8 (HIGH · with explicit revisit-in-SDD §X policy)
  artifact_log: /tmp/flatline-prd-output.log
authority: zksoju (operator) · accepted triage 2026-05-15 PM · proceeding to Phase 3 (/architect)
target_audience: agents authoring schemas + worlds composing freeside-activities + operators reading downstream
supersedes:
  - freeside-quests scaffold INTENT.md (2026-04-28 · era-1 framing)
  - freeside-quests EXTRACTION-MAP.md (2026-04-28 · pre-rename)
inherits_decisions_from: acvp-modules-genesis kickoff §12 (D1-D6 resolved 2026-05-15 PM)
related_evidence:
  - cubquests-interface/grimoires/loa/prd.md (511 lines · sovereign-migration target arch · /ride 2026-05-15)
  - cubquests-interface/content/blog/questponzi.mdx (closed-loop-reward design-decision · 50 words)
  - cubquests-interface/AGENTS.md §1 (Activities-Unification design discovery)
  - cubquests-interface/docs/RAFFLES.md (production-validated raffle architecture)
  - cubquests-interface/lib/blockchain/badge-merkle.ts (merkle-claim shape)
  - compass/packages/peripheral-events/CLAUDE.md (L2 sealed Effect Schema substrate · 80 tests)
  - compass/packages/medium-blink/CLAUDE.md (Solana Actions surface adapter)
  - compass/packages/world-sources/CLAUDE.md (hexagonal read-side port)
related_doctrine:
  - "[[agentic-cryptographically-verifiable-protocol]]" (parent · ACVP)
  - "[[freeside-modules-as-installables]]" (module-family shape)
  - "[[medium-agnostic-acvp-substrate]]" (candidate · drafted alongside kickoff)
  - "[[chat-medium-presentation-boundary]]" (substrate vs presentation)
  - "[[closed-loop-reward-mechanic]]" (candidate · drafted alongside kickoff · composition pattern)
  - "[[schema-is-not-the-contract]]" (schemas + behavior + invariants)
mode: ARCH (primary) · FRAME (lineage)
expiry: end-of-cycle OR superseded by /architect output OR explicit operator revocation
---

# PRD · freeside-activities · the unified Activity protocol

> **A sealed-schema substrate for identity-bound participation records — quests, missions, badge-claims, raffle-entries — generalized into one Activity supertype with discriminated kinds. Medium-agnostic. Chain-agnostic. ACVP-conformant. Lineage: CubQuests + Compass. Hardened by flatline round 1.**

---

## 0 · tl;dr

```
🪺  what          freeside-activities = a sealed-schema substrate where
                    Activity = {kind, period_key, steps[], reward, completion_event}
                  ONE shape covers Quest / Mission / BadgeClaim / RaffleEntry
                  (and others as worlds earn them · via WorldDefined extension seam)

🔬  why now       cubquests-team's biggest design discovery (years of production):
                    "Quests and Missions are the SAME thing — both are Activities."
                  freeside-quests scaffold doesn't reflect this · rename + generalize earns its keep

🎯  goal          ship sealed schemas + typed ports + MCP tool specs + event store contract
                    such that worlds (compass · cubquests-as-module · mibera · purupuru · fortune-PoC)
                    can compose Activity primitives without owning the substrate

🪨  scope         this module owns:
                    ▸ sealed schemas (Effect.Schema + JSON Schema + branded types)
                    ▸ canonical preimage schema (§5.6 · golden vectors · cross-runtime determinism)
                    ▸ event-store contract (FR-11 · append-only · CAS · idempotency)
                    ▸ IdentityId + IdentityResolverPort (FR-12 · cross-chain neutral)
                    ▸ typed ports with sealed error types (ProgressPort · CompletionEventPort · RewardPort · IdentityResolverPort)
                    ▸ async reward state machine (RewardPending → RewardFailed | RewardGranted)
                    ▸ MCP tool specs (agent-callable read surface)
                  this module does NOT own:
                    ▸ chain adapters (per-chain world responsibility)
                    ▸ surface adapters (Discord · Blink · Frame · per-medium)
                    ▸ world-specific content (each world's quest catalog stays in its DB)
                    ▸ identity resolution (worlds implement IdentityResolverPort)
                    ▸ partner-integration logic (per-world business logic)

🟡  composition   activities is ONE of two modules in acvp-modules-genesis cycle
                  sibling = freeside-mint (this simstim covers activities ONLY)
                  worlds compose activities + mint + their own TreasuryPort
                    to instantiate compositions like [[closed-loop-reward-mechanic]]

🚫  out-of-scope  E2E discord-to-quests (cycle-Q paused · resumes post-S3)
                  honeycomb-substrate refactor of cubquests-interface (migration cycle)
                  freeside-mint module (separate simstim · sequenced after this one)
                  on-chain contract deployment (per-world infrastructure)
                  freeside-treasury / freeside-economy / freeside-passes (don't prescribe)

🩺  flatline-r1   25 findings · 184s · $0 cost · 3-model adversarial review
                  RESOLVED in this PRD: event_id derivation · async-reward state machine ·
                  event-store contract · IdentityId shape · port error types · extension seam
                  DEFERRED to SDD: canonicalization scalars · MCP auth · MCP pagination ·
                  reward idempotency · raffle PRNG · raffle randomness
```

**🟢 elevator pitch (internal)**: *"The Activity supertype crystallizes CubQuests' years of production wisdom into a sealed substrate that any freeside-* world can compose. Not a Discord bot, not a Postgres schema, not a chain — just the typed shape of 'identity participated in something and received something back,' grounded in 7 ACVP components, hardened by 3-model adversarial review, and validated by compass's already-shipped peripheral-events instance."*

---

## 1 · problem & vision

### 1.1 · the problem (what the substrate gap actually is)

CubQuests has been running production for years. Years of design wisdom. Years of validated patterns. **The wisdom is locked inside one Next.js codebase.** When a sibling THJ world (Mibera grails · Purupuru weather-vote · Honey Port future surface · Lily fortune-PoC) wants to build "quest-like engagement," they have THREE bad choices:

1. **Re-implement from scratch** — duplicate the design discovery · risk schema divergence · doubled maintenance · the cubquests-team's wisdom doesn't carry forward
2. **Fork cubquests** — inherits the whole stack (Supabase · Vercel · Dynamic Labs · 80+ migrations) · couples to chain-specific assumptions · adoption ceiling
3. **Wait for ad-hoc extraction** — the freeside-quests scaffold attempted this 2026-04-28 (per `docs/EXTRACTION-MAP.md`) but stalled at stage-1 soft cutover · zero schemas extracted to date

**The deeper problem**: cubquests-team's BIGGEST design discovery is locked inside `cubquests-interface/AGENTS.md §1`:

> "**Core Truth**: Quests and Missions are the SAME thing — both are Activities."
> `kind: 'quest' | 'mission'` discriminant. `period_key: null = quest, "2025-W42" = mission`. ONE table. ONE API. ONE pipeline.

The freeside-quests scaffold (pre-rename) ignored this. Every package was named `quest`. The cubquests-team's discovery would be re-discovered (or worse, ignored) by every consumer world.

The fix: **rename freeside-quests → freeside-activities (done 2026-05-15) and use Activity as the supertype** with an explicit `WorldDefined` extension seam so consumer worlds aren't bottlenecked by /architect cycles for novel kinds.

### 1.2 · the vision

A sealed-schema substrate where:

- **Activity** is the canonical supertype · sealed-union `kind` discriminant + `period_key` axis + steps + reward + completion_event
- **WorldDefined** is an extension seam (closed schema · open vocabulary · worlds register their own kinds without forking the protocol)
- **Worlds compose** `freeside-activities` declaratively (per `world-manifest.yaml`: `compose_with: [freeside-activities, freeside-mint, ...]`)
- **The protocol survives surface swap** — Discord, Farcaster Frame, Solana Blink, native app, MCP tool, CLI all see the same Activity shape (per [[medium-agnostic-acvp-substrate]])
- **The protocol survives chain swap** — EVM Solidity adapter, SVM Anchor adapter (compass already has this), off-chain Postgres adapter all conform to the same ports
- **Identity is chain-agnostic** — `IdentityId` is an opaque branded string · worlds implement `IdentityResolverPort` to map → wallet/account
- **Every state mutation emits a hash-chained event** with canonically defined preimage (per ACVP component #5 events + #6 hashes)
- **The construct judges; the substrate verifies** (per [[mibera-as-npc]] two-tier doctrine)

### 1.3 · why us · why now

- **CubQuests-team's design discovery is production-validated** (~10K+ users · 22 API routes · 21 server actions · 80+ DB migrations · 11% test coverage · 8.5/10 consistency score per `cubquests-interface/grimoires/loa/consistency-report.md`)
- **Compass already shipped the substrate shape** (1/3 reference impl · `packages/peripheral-events` · 4 sealed WorldEvent variants · 80 tests · canonical eventId · Solana Frontier hackathon 2026-05-11)
- **Multiple worlds want this NOW**: Purupuru Year 2 quests · Mibera grail-claim shape · Honey Port engagement · Lily fortune-PoC · cubquests-as-module migration
- **Era-2 trigger**: CubQuests winds down as a product (per operator decree 2026-05-15) · becomes a CONSUMER of freeside-activities · this PRD is the substrate the migration consumes
- **The agentic age requires medium-agnostic substrate** (per [[medium-agnostic-acvp-substrate]] · operator 2026-05-15: "in the agentic age it's about the contracts/schemas/state machines and less so the implementation")

---

## 2 · goals & success metrics

### 2.1 · primary goals

1. **Ship sealed Activity schemas** — Effect.Schema + JSON Schema + branded types covering the 4 initial kinds + `WorldDefined` extension seam · with explicit lifecycle state machine (DEFINED → ACTIVE → PARTICIPATING → COMPLETED/EXPIRED · per HC-IMP-003)
2. **Define typed ports with sealed error types** — ProgressPort · CompletionEventPort · RewardPort · IdentityResolverPort interfaces with discriminated-union error types (per HC-IMP-014)
3. **Event store contract (FR-11)** — append-only · partition key · CAS · idempotency rules (resolves D9 + CRITICAL SKP-003)
4. **Canonical preimage schema (§5.6)** — explicit per-event preimage spec · excludes event_id from hash · golden vectors (resolves CRITICAL SKP-001)
5. **Async reward state machine** — RewardPending → RewardGranted | RewardFailed with retry handling (resolves CRITICAL SKP-001 async-reward)
6. **IdentityId + IdentityResolverPort (FR-12)** — opaque branded string + resolver port for chain-agnostic identity (resolves CRITICAL SKP-005 + DISPUTED IMP-011)
7. **MCP tool surface** — agent-callable manifest with sealed error types · pagination + auth deferred to SDD (per accepted defer)
8. **ACVP-7-component completion** — all 7 components populated for the Activity protocol
9. **Doctrine grounding** — vault doctrine pages authored alongside ([[activity-as-protocol]] · supplements [[closed-loop-reward-mechanic]] · [[merkle-snapshot-claim-pattern]] · [[weighted-raffle-draw-pattern]])

### 2.2 · measurable success criteria

| metric | target | source |
|---|---|---|
| sealed schemas authored | 8 schemas (Activity · ActivityKind incl WorldDefined · Step · Reward · RewardState · CompletionEvent · IdentityId · ProgressRecord) | `packages/protocol/` |
| typed ports defined | 4 ports + in-memory adapter (ProgressPort · CompletionEventPort · RewardPort · IdentityResolverPort) | `packages/ports/` |
| canonical preimage golden vectors | ≥ 1 per event type (5 events) · cross-runtime conformance | `packages/protocol/golden-vectors/` |
| event store contract test | append-only + CAS + duplicate-rejection invariants enforced | `packages/adapters/in-memory/__tests__/` |
| Effect.Schema test coverage | ≥ 80% line on protocol pkg | vitest |
| roundtrip golden test | define-N-activities → 2-identities-participate → 1-completes → verify-events → verify-rewards | `packages/engine/__tests__/golden.test.ts` |
| MCP manifest validated | 5 tool specs · JSON Schema valid | `packages/mcp-tools/manifest.json` |
| ACVP-7 matrix populated | every cell has concrete artifact (file path · test name · schema $id) | PRD §6 + SDD §5 |
| compass-shape conformance | Activity supertype REPRESENTS compass's 4 WorldEvent variants without lossy translation | `__tests__/compass-roundtrip.test.ts` |
| cubquests-evidence conformance | Activity supertype REPRESENTS cubquests' Activities-Unification (kind · period_key) without lossy translation | `__tests__/cubquests-roundtrip.test.ts` |
| doctrine pages authored | 4 doctrine candidates ratified to active | vault page status flips |

### 2.3 · explicit non-goals (v0)

- ❌ chain adapter implementations (each world owns chain · this module ships ports + reference Anchor adapter via compass-link)
- ❌ surface adapters (Discord renderer = cycle-Q · paused · resume post-S3)
- ❌ world-specific quest content (each world's catalog stays in its own DB)
- ❌ identity resolution implementations (worlds implement IdentityResolverPort · this module ships the port only)
- ❌ resource-economy schemas (Cores/Fuel/Crystals — cubquests-impl-detail · stays in cubquests · NOT here)
- ❌ partner integration logic (per-world business logic · cubquests has these · not module concern)
- ❌ wallet auth · session keys · indexer config (per-world infra)
- ❌ on-chain contract deployment (per-world)
- ❌ MCP authorization + privacy + tenancy (deferred to SDD · §3 MCP-AC requirements)
- ❌ MCP pagination spec (deferred to SDD · §3 PaginatedResponse wrapper)
- ❌ canonical scalar encoding policy (Date · BigInt) (deferred to SDD · §5.6 canonical scalar spec)
- ❌ raffle PRNG hardening (commit-reveal · VRF) (deferred to SDD · §5 raffle randomness OR documented v1 threat-model limitation)
- ❌ RewardPort fine-grained idempotency adapter contract (deferred to SDD · §4 port spec)
- ❌ freeside-treasury / freeside-economy / freeside-passes as separate modules (operator decree: "I don't want to prescribe")
- ❌ honeycomb-substrate refactor of freeside-activities's internal code (cycle adopts the doctrine BY CONSTRUCTION but doesn't ship a refactor of legacy scaffold code)

---

## 3 · user & stakeholder context

### 3.1 · primary persona: world-author composing activities

A developer authoring a new THJ world (Purupuru Year 2 · Lily-fortune-PoC · cubquests-as-module migration). They write `world-manifest.yaml` declaring `compose_with: [freeside-activities]`. They want:

- typed Activity schemas they can extend with world-specific fields via `WorldDefined` (no /architect bottleneck for novel kinds)
- in-memory adapter for test fixtures (no Postgres required during development)
- MCP tools their agents (ruggy · mongolian · daemon) can call to query activity state
- examples for the 4 initial kinds + extensibility recipe via `WorldDefined`
- clarity on the substrate-vs-adapter-vs-surface boundary (per [[medium-agnostic-acvp-substrate]])
- clear `IdentityResolverPort` contract so they can wire their auth substrate

### 3.2 · secondary persona: cubquests-as-module migrator

Future cycle (queued in kickoff §14): operator (or cubquests-team-equivalent) migrates `cubquests-interface` to consume `freeside-activities` as a module. They want:

- a clean import path (`import { Activity, ProgressPort, IdentityResolverPort } from '@0xhoneyjar/freeside-activities/protocol'`)
- schema migration tooling (cubquests' Postgres user_activity_progress → Activity event stream)
- zero-loss of cubquests' production wisdom (Activities-Unification carries forward · WorldDefined preserves world-specific kinds)
- a NOTES.md / runbook for the migration trajectory

### 3.3 · tertiary persona: agent reasoning about activities

A daemon or operator-construct (ruggy · KEEPER · mongolian) needs to query "what activities is this identity participating in" or "what activities has this identity completed in the past period." They consume via MCP tool specs:

- `getActiveActivities({ kind?, period_key?, world? })` → `Activity[]`
- `getProgress({ identity, activity_id })` → `ProgressRecord`
- `getBadges({ identity })` → `BadgeRecord[]`
- `getRaffleEntries({ identity, cycle_id? })` → `RaffleEntry[]`
- `listKinds()` → `string[]` (the sealed + WorldDefined discriminator values)

### 3.4 · internal stakeholders & constraints

| who | role | constraint / authority |
|---|---|---|
| **🪨 zksoju** | systems lead · cycle operator · authors schemas | owns substrate design · final say on sealed unions · accepted flatline-r1 triage 2026-05-15 |
| **🌬 eileen** | architecture ratifier · constraint enforcer | per `[[mibera-as-npc]]` §6.1: no LLM-mutating-state · construct presents · substrate verifies |
| **🐝 cubquests-team-equivalent** | production-wisdom evidence-source | reads compass/peripheral-events shape · validates the generalization holds against cubquests' Activities-Unification |
| **🪺 gumi** | NPC voice authority | per-world presentation layer voices the Activity completion (Munkh's "the mark joins the fire") · not module concern |

---

## 4 · functional requirements

### FR-1 · Activity supertype schema

**THE SYSTEM SHALL** expose a sealed `Activity` schema at `packages/protocol/Activity.ts`:

```typescript
const Activity = Schema.Struct({
  id: ActivityId,                         // branded: opaque content-addressable ID (FR-12-related derivation in SDD)
  kind: ActivityKind,                     // sealed union with WorldDefined seam (FR-2)
  period_key: Schema.NullOr(PeriodKey),   // null=quest · ISO-week=mission · custom=season
  steps: Schema.Array(ActivityStep),      // FR-3
  reward: ActivityReward,                 // FR-4
  reward_state_id: Schema.NullOr(EventId), // FR-4 async state machine pointer
  completion_event_schema: Schema.String, // $id reference to event schema (FR-5)
  world: Schema.NullOr(WorldId),          // optional binding · null=cross-world · cross-link to FR-12
  schema_version: Schema.Literal('1.0.0'),
  lifecycle_state: Schema.Literal('DEFINED','ACTIVE','PARTICIPATING','COMPLETED','EXPIRED'), // HC-IMP-003
  $id: Schema.Literal('https://schemas.freeside.thj/activity/v1.0.0'),
});
```

Constraints:
- **CL-Activity-1**: every field MUST be deterministic-canonicalizable per §5.6 (JCS-friendly) so `ActivityId` derivation is stable across re-encodes
- **CL-Activity-2**: `kind` is sealed-union WITH WorldDefined extension seam (FR-2) · adding a new BUILT-IN kind requires explicit /architect cycle · WorldDefined allows worlds to register their own without forking
- **CL-Activity-3**: `period_key` shape is decided per-`kind` (FR-2)
- **CL-Activity-4**: lifecycle_state transitions enforced by state machine (DEFINED → ACTIVE → PARTICIPATING → COMPLETED|EXPIRED · no backwards transitions · exhaustive switch at compile time per HC-IMP-003)

> Source: cubquests-interface/AGENTS.md §1 · compass/packages/peripheral-events/CLAUDE.md · flatline HC-IMP-003 (lifecycle) · HC-IMP-013 (extension seam)

### FR-2 · ActivityKind sealed union + WorldDefined extension seam + per-kind period_key shape

**THE SYSTEM SHALL** define a sealed `ActivityKind` union covering the 4 initial built-in kinds + a `WorldDefined` extension variant (resolves DISPUTED IMP-013 + HIGH SKP-001 governance):

| variant | period_key shape | source-of-truth |
|---|---|---|
| `quest` | `null` (one-shot · completion is terminal) | cubquests: user_activity_progress with period_key NULL |
| `mission` | ISO-week string (e.g., `"2025-W42"`) · recurring weekly | cubquests: weekly mission rotation via Vercel Cron |
| `badge-claim` | `null` OR `snapshot_id` (binds to merkle-snapshot · see FR-6) | cubquests: badges + badges_snapshot_mainnet (Envio + merkle) |
| `raffle-entry` | `cycle_id` (binds to raffle cycle · see FR-7) | cubquests: resource_raffle_cycles + entries |
| `world-defined` | `kind_id` (world-owned · references world-registered sub-schema $id) | NEW · worlds extend without /architect bottleneck |

```typescript
const ActivityKind = Schema.TaggedEnum({
  Quest:        { period_key: Schema.Null },
  Mission:      { period_key: PeriodKeyISOWeek },
  BadgeClaim:   { period_key: Schema.NullOr(SnapshotId) },
  RaffleEntry:  { period_key: CycleId },
  WorldDefined: {
    world_id: WorldId,
    kind_id: Schema.String,                        // e.g., 'puruhani-bond-day-7'
    sub_schema_id: Schema.String,                  // world's own $id for this kind's full shape
    period_key: Schema.NullOr(Schema.String),      // world-defined
  },
});
```

Constraints:
- **CL-ActivityKind-1**: union is sealed via Effect.Schema discriminator (exhaustive switch enforced)
- **CL-ActivityKind-2**: each built-in variant declares its `period_key` shape · resolver enforces correctness
- **CL-ActivityKind-3**: built-in variants added only via /architect (extensibility seam · not free-form)
- **CL-ActivityKind-4**: `WorldDefined` is the operator-latitude escape · world registers its sub-schema $id · the substrate validates that `kind_id` and `sub_schema_id` are non-empty and `sub_schema_id` is a valid URI · the substrate does NOT validate the world's sub-schema (world's responsibility)

> Source: cubquests-interface/AGENTS.md §1 · cubquests-interface/docs/RAFFLES.md · cubquests-interface/lib/blockchain/badge-merkle.ts · flatline DISPUTED IMP-013 (extension seam) + HIGH SKP-001 (governance bottleneck mitigation)

### FR-3 · ActivityStep schema

**THE SYSTEM SHALL** define a sealed `ActivityStep` schema:

```typescript
const ActivityStep = Schema.Struct({
  step_id: StepId,
  description: Schema.String,                    // free text · world skins this
  verification: VerificationMethod,              // FR-3.1
  required: Schema.Boolean,                      // false = optional step
  order: Schema.Number,                          // sequencing within steps[]
});

const VerificationMethod = Schema.TaggedEnum({
  ManualCurator: { curator_id: Schema.String },
  SignedMemoTx:  { chain: Schema.String },                  // ed25519 / EIP-191 signed memo
  MerkleProof:   { snapshot_id: SnapshotId },               // cubquests merkle pattern
  WebhookHmac:   { source: Schema.String, secret_env: Schema.String },
  PartnerApi:    { partner_id: PartnerId, endpoint: Schema.String },
  OnChainEvent:  { contract: Schema.String, event: Schema.String, vm: Schema.Literal('evm','svm','move','other') }, // D12 resolved
});
```

Constraints:
- **CL-Step-1**: VerificationMethod is sealed-union · new methods via /architect
- **CL-Step-2**: every step verification produces a `CompletionEvent` (FR-5) hash-bound to the step
- **CL-Step-3**: `OnChainEvent.vm` discriminates VM-class (resolves new D12)

> Source: cubquests-interface server actions generalize to VerificationMethod · D12 resolved per flatline HC-IMP-001 (open decisions not deferrable)

### FR-4 · ActivityReward schema + async reward state machine

**THE SYSTEM SHALL** define a sealed `ActivityReward` schema covering reward types worlds emit + a state machine for async delivery (resolves CRITICAL SKP-001 async-reward · HC-IMP-005):

```typescript
const ActivityReward = Schema.TaggedEnum({
  BadgeMint:    { mint_intent_id: MintIntentId },           // FORWARD-COMPAT: shape defined by sibling freeside-mint cycle
  TokenAmount:  { token_id: TokenId, amount_decimal: Schema.String, decimals: Schema.Number }, // BigInt as decimal-string per §5.6
  Resource:     { resource_kind: Schema.String, amount: Schema.Number },  // world-defined economy
  Cosmetic:     { cosmetic_id: CosmeticId },
  External:     { reward_uri: Schema.String, claim_proof: Schema.String },
  None:         { /* completion is the reward · narrative-only */ },
});

// FR-4.1 · async reward state machine
const RewardState = Schema.TaggedEnum({
  RewardPending:  { reward_intent: ActivityReward, originating_event_id: EventId, attempts: Schema.Number },
  RewardGranted:  { reward: ActivityReward, originating_event_id: EventId, granted_event_id: EventId, ts: Schema.String },
  RewardFailed:   { reward_intent: ActivityReward, originating_event_id: EventId, failure_reason: Schema.String, ts: Schema.String, retryable: Schema.Boolean },
});

// state machine transitions (FR-4.2)
// Pending → Granted    (success)
// Pending → Failed (retryable)  → may transition back to Pending (operator-triggered retry)
// Pending → Failed (terminal)   → no further transitions
```

Constraints:
- **CL-Reward-1**: `BadgeMint` composes with freeside-mint sibling module · this module declares the `mint_intent_id` REFERENCE only · the MintIntent shape is freeside-mint's responsibility (HC-IMP-005)
- **CL-Reward-2**: every reward emission MUST emit `RewardPending` FIRST · only on confirmed delivery transitions to `RewardGranted`
- **CL-Reward-3**: `originating_event_id` links the RewardState chain back to the `ActivityCompleted` event that triggered it (hash-chain-continuity)
- **CL-Reward-4**: `TokenAmount.amount_decimal` is a string-encoded decimal (NOT BigInt) per §5.6 canonical scalar policy (defers BigInt scalar policy to SDD §5 canonical scalar spec but mandates string encoding at PRD level)
- **CL-Reward-5**: idempotency for `RewardPort.grant` is DEFERRED to SDD §4 with explicit revisit-in-SDD requirement (HIGH SKP-003 deferred)

> Source: cubquests-interface reward patterns + compass/peripheral-events + crayons-monorepo FeeSplit · flatline CRITICAL SKP-001 (async reward state machine) · DEFERRED SKP-003 (idempotency)

### FR-5 · CompletionEvent + event-stream schema + canonical preimage

**THE SYSTEM SHALL** define the canonical event stream with explicit preimage schema (resolves CRITICAL SKP-001 event_id derivation):

```typescript
// EventEnvelope · EVERY event carries this (per ACVP component #5 + #6)
const EventEnvelope = Schema.Struct({
  event_id: EventId,                              // SHA-256(canonical_preimage) · see §5.6
  preimage_schema_id: Schema.String,              // $id of the per-event preimage schema (NEW)
  ts: Schema.String,                              // RFC3339 string (NOT Schema.Date · per §5.6)
  source_event_hash: Schema.NullOr(EventId),      // hash-chain · null=root event
  nonce: Schema.NullOr(Schema.String),            // optional · idempotency-key when caller supplies (resolves SKP-002 collision)
  schema_version: Schema.Literal('1.0.0'),
  $id: Schema.String,                              // schema $id of THIS event type
});

const ActivityCompleted = Schema.extend(EventEnvelope, {
  $id: Schema.Literal('https://schemas.freeside.thj/activity-completed/v1.0.0'),
  preimage_schema_id: Schema.Literal('https://schemas.freeside.thj/preimage/activity-completed/v1.0.0'),
  activity_id: ActivityId,
  identity_id: IdentityId,                        // FR-12
  period_key: Schema.NullOr(PeriodKey),
  step_completions: Schema.Array(StepCompletion),
  reward_state_id: Schema.NullOr(EventId),        // FR-4 RewardState pointer
});

const BadgeIssued      = Schema.extend(EventEnvelope, { /* canonical preimage in §5.6 */ });
const RaffleDrawn      = Schema.extend(EventEnvelope, { /* canonical preimage in §5.6 */ });
const ProgressAdvanced = Schema.extend(EventEnvelope, { /* canonical preimage in §5.6 */ });
const RewardPending    = Schema.extend(EventEnvelope, { /* canonical preimage in §5.6 */ });
const RewardGranted    = Schema.extend(EventEnvelope, { /* canonical preimage in §5.6 */ });
const RewardFailed     = Schema.extend(EventEnvelope, { /* canonical preimage in §5.6 */ });
```

Constraints (ACVP invariants):
- **CL-Event-1** (event-completeness): every Activity state mutation MUST emit ≥ 1 event
- **CL-Event-2** (hash-chain-continuity): every event's `source_event_hash` MUST resolve to a prior event in the stream (or null for roots)
- **CL-Event-3** (hash-determinism): same canonical preimage → same event_id → deterministic replay
- **CL-Event-4** (canonical encoding): JCS (RFC 8785) for preimage AFTER stripping `event_id` field · see §5.6 for per-event preimage schemas
- **CL-Event-5** (collision-distinguishing): when caller supplies `nonce`, two events with identical other-fields are treated as distinct (resolves SKP-002 HIGH collision)

> Source: compass/packages/peripheral-events · ACVP-7-component matrix · flatline CRITICAL SKP-001 (canonical preimage) + HIGH SKP-002 (collision handling)

### FR-6 · BadgeClaim discriminant + merkle-snapshot binding

**WHEN** `Activity.kind = 'BadgeClaim'`,
**THE SYSTEM SHALL** require:
- `period_key = snapshot_id` (binds to a specific merkle snapshot)
- `steps[]` containing exactly one step with `VerificationMethod = MerkleProof`
- on completion: emit `BadgeIssued` with `merkle_proof` field + `snapshot_id`

```typescript
const BadgeClaim = Activity.pipe(Schema.filter(a =>
  a.kind._tag === 'BadgeClaim' && a.kind.period_key !== null
));
```

> Source: cubquests-interface/lib/blockchain/badge-merkle.ts + lib/badge-snapshot/ · composes with [[merkle-snapshot-claim-pattern]] doctrine candidate

### FR-7 · RaffleEntry discriminant + cycle binding

**WHEN** `Activity.kind = 'RaffleEntry'`,
**THE SYSTEM SHALL** require:
- `period_key = cycle_id` (binds to a specific raffle cycle)
- `steps[]` containing exactly one step with `VerificationMethod = OnChainEvent` OR `SignedMemoTx`
- entry payload schema includes `tickets: number` + `idempotency_key: string`

```typescript
const RaffleEntry = Activity.pipe(Schema.filter(a =>
  a.kind._tag === 'RaffleEntry'
));
```

Constraints:
- **CL-Raffle-1**: idempotency-key prevents double-entry (cubquests production pattern: atomic Postgres RPC FOR UPDATE row-lock)
- **CL-Raffle-2**: cycle binding is immutable post-entry (no late-cycle migration)
- **CL-Raffle-3**: raffle PRNG hardening DEFERRED to SDD with explicit revisit (HIGH SKP-003 + SKP-005) — SDD MUST address: (a) commit-reveal seed publication OR (b) VRF integration OR (c) documented v1 threat-model downgrade ("NOT suitable for adversarial high-value distribution")

> Source: cubquests-interface/docs/RAFFLES.md production architecture · composes with [[weighted-raffle-draw-pattern]] doctrine candidate · flatline HIGH SKP-003 + SKP-005 (raffle PRNG · deferred to SDD)

### FR-8 · Typed ports with sealed error types (per HC-IMP-014)

**THE SYSTEM SHALL** expose 4 ports at `packages/ports/` with discriminated-union error types:

```typescript
// packages/ports/progress-port.ts
const ProgressError = Schema.TaggedEnum({
  ActivityNotFound:    { activity_id: ActivityId },
  IdentityNotFound:    { identity_id: IdentityId },
  ConcurrentUpdate:    { activity_id: ActivityId, current_version: Schema.Number, attempted_version: Schema.Number },
  AdapterUnavailable:  { adapter_id: Schema.String, reason: Schema.String },
});
interface ProgressPort {
  getProgress(activityId: ActivityId, identityId: IdentityId): Effect.Effect<ProgressRecord, ProgressError>;
  advanceProgress(event: ProgressAdvanced): Effect.Effect<ProgressRecord, ProgressError>;
}

// packages/ports/completion-event-port.ts
const EventError = Schema.TaggedEnum({
  InvalidChain:        { event_id: EventId, expected_source_hash: EventId, actual_source_hash: Schema.NullOr(EventId) },
  DuplicateEvent:      { event_id: EventId },
  SchemaValidation:    { event_id: EventId, schema_id: Schema.String, errors: Schema.Array(Schema.String) },
  AdapterUnavailable:  { adapter_id: Schema.String, reason: Schema.String },
});
interface CompletionEventPort {
  emit(event: ActivityCompleted): Effect.Effect<EventId, EventError>;
  query(filter: EventFilter): Effect.Effect<ReadonlyArray<ActivityCompleted>, EventError>;
}

// packages/ports/reward-port.ts
const RewardError = Schema.TaggedEnum({
  AlreadyGranted:      { originating_event_id: EventId, existing_grant_id: EventId },
  GrantFailed:         { reward_intent: ActivityReward, reason: Schema.String, retryable: Schema.Boolean },
  IdentityUnresolvable:{ identity_id: IdentityId },
  AdapterUnavailable:  { adapter_id: Schema.String, reason: Schema.String },
});
interface RewardPort {
  grant(reward: ActivityReward, recipient: IdentityId, originatingEventId: EventId): Effect.Effect<RewardGranted, RewardError>;
  query(identity: IdentityId): Effect.Effect<ReadonlyArray<RewardGranted>, RewardError>;
}

// packages/ports/identity-resolver-port.ts (FR-12 details)
const IdentityResolverError = Schema.TaggedEnum({
  UnresolvableIdentity:{ identity_id: IdentityId },
  ChainNotSupported:   { chain: Schema.String },
  ResolverUnavailable: { resolver_id: Schema.String, reason: Schema.String },
});
interface IdentityResolverPort {
  resolveToChainAddress(identity: IdentityId, chain: Schema.String): Effect.Effect<Schema.String, IdentityResolverError>;
  resolveFromChainAddress(address: Schema.String, chain: Schema.String): Effect.Effect<IdentityId, IdentityResolverError>;
  // CL-Identity-3 + CL-Identity-4 see FR-12
}
```

**THE SYSTEM SHALL** ship in-memory adapters for all 4 ports at `packages/adapters/in-memory/` (test fixtures · no Postgres required).

Constraints:
- **CL-Port-1**: every port operation returns an `Effect<R, E>` where E is the port's sealed-union error type · NO bare exceptions
- **CL-Port-2**: error types are part of the public contract · adapters MUST cover every variant in their failure-handling tests

> Source: compass/packages/world-sources hexagonal port + mock/live resolver pattern · flatline DISPUTED IMP-014 (sealed port errors)

### FR-9 · MCP tool surface

**THE SYSTEM SHALL** expose 5 MCP tool specs at `packages/mcp-tools/manifest.json`:

| tool | description | inputs | output |
|---|---|---|---|
| `getActiveActivities` | list active activities | `{ kind?, period_key?, world? }` | `Activity[]` |
| `getProgress` | user's progress on activity | `{ identity_id, activity_id }` | `ProgressRecord` |
| `getBadges` | user's badge claims | `{ identity_id, world? }` | `BadgeRecord[]` |
| `getRaffleEntries` | user's raffle entries | `{ identity_id, cycle_id? }` | `RaffleEntry[]` |
| `listKinds` | the sealed-union kinds + world-defined kinds (paginated · see SDD) | `{}` | `string[]` |

Constraints:
- **CL-MCP-1**: every tool input + output JSON-Schema-validated · matches sealed schemas
- **CL-MCP-2**: tools are READ-ONLY · no mutations via MCP (state changes happen via typed ports + completion events)
- **CL-MCP-3**: every tool response carries `schema_version` field for forward-compat
- **CL-MCP-4**: pagination DEFERRED to SDD §3 with explicit revisit (HIGH SKP-002 deferred) — SDD MUST define cursor-based pagination + PaginatedResponse wrapper for all list operations
- **CL-MCP-5**: authorization + privacy + tenancy DEFERRED to SDD §3 with explicit revisit (HIGH SKP-004 deferred) — SDD MUST define MCP-AC requirements (caller identity · world scope · subject authorization · audit logging · rate limits · privacy-safe filtering for identity_id queries)

> Source: ruggy (freeside-characters) + freeside-dashboard MCP · flatline HIGH SKP-002 (pagination) + SKP-004 (auth) deferred to SDD

### FR-10 · Chat-medium-presentation-boundary discipline (documented convention · per DISPUTED IMP-016)

**THE SYSTEM SHALL** document a presentation-boundary convention (NOT a CI-enforced lint at protocol-package level):
- substrate emits: `activity_id: ActivityId · period_key: PeriodKey · event_id: EventId`
- presentation translates: "your daily omen carries forward to tomorrow's tide"

**Enforced by**:
- documentation in INTENT.md + INTEGRATION-PATH.md (convention · world adapter responsibility)
- golden test suite in CONSUMER WORLDS (NOT in this protocol package · since it has no user-visible surface)
- mirrors compass/medium-blink discipline (which lives in the SURFACE package · not the substrate package)

**Rationale for downgrade**: the original FR-10 proposed CI-gated lint, but flatline DISPUTED IMP-016 surfaced that CMP-lint has weak enforcement inside a UI-less substrate package. The substrate has NO user-visible strings to scan. Lint enforcement belongs in surface adapter packages (medium-blink · medium-discord · etc).

> Source: [[chat-medium-presentation-boundary]] · cycle-r-cmp-boundary architecture proof-points 2026-05-04 · flatline DISPUTED IMP-016 (CMP-lint scoping)

### FR-11 · Event Store Contract (NEW · resolves D9 + CRITICAL SKP-003)

**THE SYSTEM SHALL** define the canonical event store contract that every CompletionEventPort adapter MUST satisfy:

```typescript
// packages/protocol/event-store-contract.ts
interface EventStoreContract {
  // Append-only · monotonic ordering within a partition
  append(event: EventEnvelope, partition: PartitionKey): Effect.Effect<AppendReceipt, EventStoreError>;
  
  // Read by partition + sequence range
  read(partition: PartitionKey, fromSeq: Sequence, toSeq?: Sequence): Effect.Effect<ReadonlyArray<EventEnvelope>, EventStoreError>;
  
  // Compare-and-swap on partition tip (optimistic concurrency)
  appendIfTipMatches(event: EventEnvelope, partition: PartitionKey, expectedTip: EventId): Effect.Effect<AppendReceipt, EventStoreError>;
  
  // Get partition's current tip (for CAS pre-check)
  getTip(partition: PartitionKey): Effect.Effect<Schema.NullOr<EventId>, EventStoreError>;
}
```

Constraints:
- **CL-EventStore-1** (append-only): events are NEVER mutated post-append · no UPDATE · no DELETE · only INSERT
- **CL-EventStore-2** (monotonic-sequence): within a partition, sequence numbers are strictly monotonic + dense (no gaps)
- **CL-EventStore-3** (partition-isolation): cross-partition ordering is NOT guaranteed · within-partition ordering IS guaranteed
- **CL-EventStore-4** (CAS-on-tip): concurrent writers detect conflict via `appendIfTipMatches` · adapters MUST implement CAS semantics
- **CL-EventStore-5** (duplicate-rejection): duplicate event_id within same partition rejected with `DuplicateEvent` error
- **CL-EventStore-6** (replay-deterministic): reading partition from seq=0 → end produces identical event stream across adapter implementations
- **CL-EventStore-7** (partition-key-policy): SDD MUST define partition key derivation (recommended: `activity_id` for activity-scoped events · `world_id + identity_id` for identity-scoped events · resolved in SDD)

**PartitionKey shape**:
- SDD §2 defines the canonical partition-key derivation
- v1 expectation: `partition_key = { scope: 'activity'|'identity'|'world'|'global', value: string }`

> Source: flatline CRITICAL SKP-003 (event store ordering D9 not deferrable) · cubquests' atomic Postgres RPC pattern generalized · compass/peripheral-events implicit sequencing made explicit

### FR-12 · IdentityId + IdentityResolverPort (NEW · resolves D11 + CRITICAL SKP-005 + DISPUTED IMP-011)

**THE SYSTEM SHALL** define IdentityId as an opaque branded string and ship an IdentityResolverPort interface that worlds implement:

```typescript
// packages/protocol/branded/IdentityId.ts
const IdentityId = Schema.String.pipe(
  Schema.brand('IdentityId'),
  Schema.pattern(/^id_[a-z0-9]{1,128}$/),  // namespaced · max 128 lowercase alphanumeric after 'id_' prefix
);

// The substrate considers IdentityId OPAQUE.
// It does NOT specify wallet address · DID · TBA · ENS · etc.
// Worlds resolve IdentityId → actual identity primitives via IdentityResolverPort.
```

Constraints:
- **CL-Identity-1** (opaque): the substrate does NOT interpret IdentityId · treats as opaque content-addressable handle
- **CL-Identity-2** (stable): same IdentityId across worlds refers to the same logical identity (worlds must agree on IdentityId derivation · or have a federated resolver)
- **CL-Identity-3** (resolution-out-of-scope): identity resolution (IdentityId → wallet / EVM address / SVM pubkey / TBA / DID / ENS) is the consumer world's responsibility via IdentityResolverPort
- **CL-Identity-4** (multi-chain-via-port): same IdentityId can map to DIFFERENT chain-specific addresses · the resolver port handles per-chain resolution
- **CL-Identity-5** (privacy-preserving): the substrate stores IdentityId only · worlds choose what they expose via their resolver impl (privacy-safe queries vs full-graph lookups)

**Reference implementation seam**:
- worlds with EVM-only identity: implement resolver mapping IdentityId → 0x-address
- worlds with cross-chain identity (per `chain: 'evm'|'svm'|'move'`): implement resolver with per-chain branches
- worlds with TBA-based identity: resolver maps IdentityId → parent NFT address + chain
- worlds with DID-based identity: resolver does W3C DID resolution
- worlds that use freeside-auth (sibling module): consume freeside-auth's resolver implementation

> Source: flatline CRITICAL SKP-005 (IdentityId not deferrable) · DISPUTED IMP-011 (opaque branded pragmatic) · cross-cuts freeside-* family · resolved in PRD per HC-IMP-001

---

## 5 · technical & non-functional requirements

### 5.1 · stack

- **runtime**: TypeScript strict · Effect 3.x · Effect.Schema for sealed types
- **package manager**: bun (consistency with bonfire ecosystem)
- **testing**: vitest · Effect-test patterns · golden replay fixtures · per-event preimage roundtrip tests
- **JSON Schema generation**: derive JSON Schema from Effect.Schema at build (`packages/protocol/build/json-schema.ts`)
- **versioning**: tentatively `CURRENT_SCHEMA_VERSION + PACKAGE_VERSION` pin pattern (mirror compass/peripheral-events) · /architect re-ratifies in SDD §5.6
- **publication**: scoped npm package `@0xhoneyjar/freeside-activities` · workspace monorepo per [[freeside-modules-as-installables]]

### 5.2 · package layout (per [[freeside-modules-as-installables]])

```
freeside-activities/
├── packages/
│   ├── protocol/                          (sealed schemas · the load-bearing surface)
│   │   ├── Activity.ts
│   │   ├── ActivityKind.ts                (sealed + WorldDefined seam)
│   │   ├── ActivityStep.ts
│   │   ├── ActivityReward.ts              (with RewardState · async state machine)
│   │   ├── event-store-contract.ts        (FR-11 · NEW)
│   │   ├── events/
│   │   │   ├── EventEnvelope.ts
│   │   │   ├── ActivityCompleted.ts
│   │   │   ├── BadgeIssued.ts
│   │   │   ├── RaffleDrawn.ts
│   │   │   ├── ProgressAdvanced.ts
│   │   │   ├── RewardPending.ts
│   │   │   ├── RewardGranted.ts
│   │   │   └── RewardFailed.ts
│   │   ├── branded/
│   │   │   ├── ActivityId.ts
│   │   │   ├── EventId.ts
│   │   │   ├── IdentityId.ts              (FR-12 · NEW)
│   │   │   ├── PeriodKey.ts
│   │   │   ├── PartitionKey.ts            (FR-11 · NEW)
│   │   │   └── ...
│   │   ├── preimage/                       (§5.6 · NEW)
│   │   │   ├── activity-completed.preimage.ts
│   │   │   ├── badge-issued.preimage.ts
│   │   │   ├── raffle-drawn.preimage.ts
│   │   │   ├── progress-advanced.preimage.ts
│   │   │   └── reward-state.preimage.ts
│   │   ├── golden-vectors/                 (§5.6 · NEW · per IMP-012)
│   │   │   ├── activity-completed.golden.json
│   │   │   ├── badge-issued.golden.json
│   │   │   ├── raffle-drawn.golden.json
│   │   │   └── ...
│   │   ├── build/json-schema.ts          (derive JSON Schema)
│   │   └── __tests__/
│   ├── ports/                             (typed interfaces + sealed error types)
│   │   ├── progress-port.ts               (with ProgressError)
│   │   ├── completion-event-port.ts       (with EventError)
│   │   ├── reward-port.ts                 (with RewardError)
│   │   ├── identity-resolver-port.ts     (FR-12 · with IdentityResolverError)
│   │   └── index.ts
│   ├── adapters/
│   │   ├── in-memory/                    (test fixtures · default for development)
│   │   │   ├── progress.ts
│   │   │   ├── completion-event.ts        (event-store-contract conformant)
│   │   │   ├── reward.ts
│   │   │   ├── identity-resolver.ts       (FR-12 · stub world identity)
│   │   │   └── __tests__/
│   │   └── README.md                     (lists future adapters worlds may build)
│   ├── mcp-tools/
│   │   ├── manifest.json
│   │   └── tools/                         (5 tool specs · pagination + auth SDD-deferred)
│   ├── engine/                            (headless composition · golden tests)
│   │   ├── compose.ts                    (composes Activity + adapters at runtime)
│   │   ├── lifecycle.ts                   (Activity state-machine driver per HC-IMP-003)
│   │   └── __tests__/golden.test.ts
│   └── ui/                                (DEFERRED · stays as-is for now · cycle-Q resumes for Discord renderer post-S3)
├── docs/
│   ├── INTENT.md                          (rewritten · post-rename framing)
│   ├── EXTRACTION-MAP.md                  (rewritten · maps cubquests/compass to packages)
│   ├── INTEGRATION-PATH.md                (rewritten · staged adoption per world)
│   ├── ACVP-MATRIX.md                     (the 7-component matrix · canonical reference)
│   ├── CMP-CONVENTION.md                  (FR-10 convention · for world adapter authors)
│   └── flatline-round-1-amendment.md     (this PRD r2 · flatline findings + triage)
├── grimoires/
│   └── loa/                               (this PRD + SDD + sprint + NOTES + reality)
├── CLAUDE.md                              (rewritten · drop legacy freeside-quests scaffold content)
├── package.json                           (name: @0xhoneyjar/freeside-activities)
└── .loa.config.yaml                       (already set 2026-05-15)
```

### 5.3 · performance

- schema validation (Effect.Schema decode/encode): ≤ 1ms per Activity instance on cold start · ≤ 100µs on warm
- golden-replay determinism check (full event stream of N=100 events): ≤ 100ms

### 5.4 · security

- no API keys committed
- schema deserialization MUST reject extra fields by default (no silent field acceptance)
- branded types enforce constructor discipline (no raw string → branded coercion outside the package)
- MCP tools READ-ONLY (no mutation surface)
- MCP authorization + tenancy DEFERRED to SDD §3 (per CL-MCP-5)

### 5.5 · ACVP audit envelope inheritance (cycle-098 L1)

This module's events SHALL OPTIONALLY emit through `audit_emit` (Loa cycle-098 L1) at adapter-instantiation level. The substrate declares envelope-conformance fields (`event_id`, `source_event_hash`, `schema_version`, `$id`, `preimage_schema_id`, `nonce`) and worlds choose whether to layer in Ed25519 signatures.

> Source: [[agentic-cryptographically-verifiable-protocol]] · Loa cycle-098 L1 audit envelope

### 5.6 · Canonical Preimage Schema (NEW · resolves CRITICAL SKP-001 event_id derivation)

Every event has a **canonical preimage schema** that defines EXACTLY which fields enter the JCS-canonicalized hash. The `event_id` field is EXCLUDED from its own preimage (no self-reference). The preimage_schema_id field on each event identifies its preimage schema.

**General rules** (apply to all event preimages):
- `event_id` is EXCLUDED from the preimage (it's the hash output)
- `preimage_schema_id` IS INCLUDED (so preimage schema evolution is hash-detectable)
- Fields ordered by JCS (RFC 8785) before hashing
- Timestamps encoded as RFC3339 strings (NOT Date objects · NOT epoch integers · NOT BigInt)
- BigInt-shaped values (token amounts) encoded as decimal strings with explicit `decimals` field
- Null vs absent: explicit JSON null in preimage (NOT field absence)

**Per-event preimage schemas** (canonical $id-stable):

```typescript
// preimage/activity-completed.preimage.ts
const ActivityCompletedPreimage = Schema.Struct({
  preimage_schema_id: Schema.Literal('https://schemas.freeside.thj/preimage/activity-completed/v1.0.0'),
  ts: Schema.String,                              // RFC3339
  source_event_hash: Schema.NullOr(EventId),
  nonce: Schema.NullOr(Schema.String),
  schema_version: Schema.Literal('1.0.0'),
  $id: Schema.Literal('https://schemas.freeside.thj/activity-completed/v1.0.0'),
  activity_id: ActivityId,
  identity_id: IdentityId,
  period_key: Schema.NullOr(PeriodKey),
  step_completions: Schema.Array(StepCompletion),  // ordered by step.order
  reward_state_id: Schema.NullOr(EventId),
});

// event_id derivation:
//   event_id = SHA-256(canonical_jcs(ActivityCompletedPreimage.parse(event_minus_event_id)))

// Similar preimage definitions for:
//   BadgeIssuedPreimage
//   RaffleDrawnPreimage
//   ProgressAdvancedPreimage
//   RewardPendingPreimage
//   RewardGrantedPreimage
//   RewardFailedPreimage
```

**Golden vectors** (required artifact per HC-IMP-002 + DISPUTED IMP-012):
- `packages/protocol/golden-vectors/<event-type>.golden.json` — N=3 worked examples per event type · each shows input event + expected event_id
- Tests in every adapter implementation MUST verify their hash output matches the golden vectors (cross-runtime determinism)

**SDD revisit-deferred** (per HIGH SKP-002):
- canonical scalar encoding policy (Date · BigInt) deferred to SDD §5.6 canonical scalar spec
- exact JCS canonicalization library choice (rfc8785.js vs canonicalize vs custom) deferred to SDD
- nonce generation convention (worlds-supply · operator-supply · auto-generate) deferred to SDD

> Source: flatline CRITICAL SKP-001 (event_id derivation) · HC-IMP-002 (canonicalization) · DISPUTED IMP-012 (pinned fixture authority)

---

## 6 · ACVP-7-component matrix (load-bearing for cycle close)

| # | component | concrete artifact |
|---|---|---|
| 1 | **Reality** | per-world `progress` (via ProgressPort impl) · per-world event store (via CompletionEventPort + FR-11 EventStoreContract) · per-world identity resolution (via IdentityResolverPort) · canonical state of "what identities participated in what activities when, with what evidence, with what reward outcome" |
| 2 | **Contracts** | `ActivityKind` sealed union + `WorldDefined` extension seam · `ActivityStep` sealed · `ActivityReward` sealed · `RewardState` sealed (Pending/Granted/Failed) · 4 typed ports with discriminated-union error types · `EventEnvelope` for all events · `EventStoreContract` for adapters |
| 3 | **Schemas** | Effect.Schema definitions per FR-1 through FR-12 · JSON-Schema $id-stable derivations · per-event preimage schemas at `packages/protocol/preimage/` · golden vectors at `packages/protocol/golden-vectors/` |
| 4 | **State machines** | Activity lifecycle: `DEFINED → ACTIVE → PARTICIPATING → COMPLETED/EXPIRED` (HC-IMP-003) · RewardState: `Pending → Granted | Failed` with retry (FR-4.2) · BadgeClaim sub-state: `ELIGIBLE → CLAIMED` · RaffleEntry sub-state: `OPEN → ENTERED → DRAWN` · exhaustive switch enforced at compile time |
| 5 | **Events** | `ActivityCompleted` · `BadgeIssued` · `RaffleDrawn` · `ProgressAdvanced` · `RewardPending` · `RewardGranted` · `RewardFailed` · all with EventEnvelope (event_id · preimage_schema_id · source_event_hash · nonce · ts · schema_version · $id) |
| 6 | **Hashes** | `event_id = SHA-256(canonical_jcs(per-event-preimage))` · explicit preimage schemas in §5.6 · `activity_id = SHA-256(canonical_jcs(definition))` · merkle-root for badge-snapshots · raffle-draw seed (per FR-7 · hardening SDD-deferred) |
| 7 | **Tests** | golden replay in `packages/engine/__tests__/golden.test.ts` · per-event preimage golden vectors (cross-runtime determinism) · roundtrip per schema · compass-shape conformance · cubquests-evidence conformance · event-store-contract invariants per adapter |

---

## 7 · scope & prioritization

### 7.1 · MVP (must-ship by cycle close)

- ✅ FR-1 through FR-12 (sealed schemas · typed ports · MCP tools · event store · identity port)
- ✅ §5.6 canonical preimage schema with per-event preimage definitions + golden vectors
- ✅ ACVP-7-component matrix fully populated
- ✅ in-memory adapter for all 4 ports (test fixtures)
- ✅ event-store-contract adapter conformance tests
- ✅ 4 vault doctrine pages active ([[activity-as-protocol]] · [[closed-loop-reward-mechanic]] · [[merkle-snapshot-claim-pattern]] · [[weighted-raffle-draw-pattern]])
- ✅ rewritten INTENT.md · EXTRACTION-MAP.md · INTEGRATION-PATH.md · ACVP-MATRIX.md · CMP-CONVENTION.md · CLAUDE.md
- ✅ workspace published-ready (`@0xhoneyjar/freeside-activities` · scoped · npm publish-ready · do NOT publish in this cycle)

### 7.2 · post-cycle (queued for follow-up cycles per kickoff §14)

- cycle-Q resume → `medium-discord` package (mirroring compass/medium-blink shape)
- `cubquests-as-module-migration` cycle (cubquests-interface consumes freeside-activities + freeside-mint)
- additional medium adapters (Frame · Blink-EVM via Dialect · MCP-native)
- chain adapters (Solidity · further-Anchor · off-chain Postgres)

---

## 8 · risks & dependencies

### 8.1 · technical risks

| risk | likelihood | impact | mitigation |
|---|---|---|---|
| Effect.Schema version drift vs compass | low | medium | pin to same major version as compass · compass-roundtrip conformance test catches drift |
| WorldDefined extension seam abused (worlds register too many kinds · ecosystem fragments) | medium | medium | document the `kind_id` discipline · per-world namespace convention in INTEGRATION-PATH.md · /architect monitoring |
| canonical preimage golden vectors drift across runtimes (TS vs Rust vs Python) | medium | high | per-event golden vectors in golden-vectors/ · cross-runtime parity test required for any adapter outside TS |
| async reward retry storms (RewardFailed-retryable loop) | low | medium | adapter-level exponential backoff · max-attempts policy in SDD §4 |
| IdentityResolverPort federation fragility (worlds disagree on IdentityId derivation) | medium | medium | DOCUMENT the canonical IdentityId derivation in SDD · provide a default freeside-auth resolver |
| event store partition-key choice creates hot-spots | low | medium | SDD §2 must consider partition-key entropy · in-memory adapter's default partitions activity-id |
| raffle PRNG hardening deferred to SDD becomes the bottleneck | medium | medium | SDD MUST address per FR-7 deferred requirement · escalate if SDD also defers |
| MCP authorization deferred to SDD becomes ship-blocker | low | medium | SDD MUST address per CL-MCP-5 · escalate if SDD also defers |
| schema $id versioning collides with compass's $id namespace | low | low | use `schemas.freeside.thj/<schema>/<version>` namespace · audit during /architect |

### 8.2 · dependency risks

| dep | owner | risk | mitigation |
|---|---|---|---|
| compass/peripheral-events shape stability | compass cycle-1 (shipped 2026-05-11) | compass team may revise post-Frontier | freeze compass-roundtrip conformance against the shipped version · compass evolution earns its own conformance bump |
| cubquests-interface evidence (production data + AGENTS.md wisdom) | cubquests-interface (winding down) | wind-down may delete artifacts | snapshot the evidence into `grimoires/loa/reality/cubquests-snapshot-2026-05-15/` for archeology |
| freeside-mint sibling module (separate simstim · sequenced) | acvp-modules-genesis cycle | ActivityReward.BadgeMint depends on freeside-mint MintIntentId schema | declare MintIntentId shape DEFERRED to freeside-mint cycle · reference forward-compat schema |
| Effect.Schema major version bumps | Effect ecosystem | breaking changes between simstim runs | lock package.json version · semver-strict |

---

## 9 · doctrine composition

| doctrine | role in this PRD | proof point |
|---|---|---|
| `[[agentic-cryptographically-verifiable-protocol]]` | parent · 7-component matrix is THE gate · canonical preimage is the hash-chain ground | FR-1 through FR-12 + §6 matrix |
| `[[freeside-modules-as-installables]]` | sealed schemas + typed ports + per-module autonomy | §5.2 package layout |
| `[[medium-agnostic-acvp-substrate]]` | substrate vs adapter vs surface tri-layer · NO surface leak | FR-10 + §5.4 |
| `[[chat-medium-presentation-boundary]]` | substrate emits canonical · presentation translates (convention not lint) | FR-10 (documented convention) |
| `[[mibera-as-npc]]` | two-tier (construct judges · substrate verifies) | §3.4 eileen constraint · MCP READ-ONLY (CL-MCP-2) |
| `[[schema-is-not-the-contract]]` | schemas describe shape · contracts include behavior + invariants | the constraints CL-* are the behavior layer |
| `[[contracts-as-bridges]]` | typed ports as load-bearing bridges | FR-8 + FR-12 hexagonal ports |
| `[[closed-loop-reward-mechanic]]` | candidate (drafted alongside kickoff) · the composition pattern this module + freeside-mint instantiate | §7.2 sibling cycles |
| `[[activity-as-protocol]]` | candidate (to be drafted in S3) · the canonical doctrine page for THIS module | this PRD seeds it |

---

## 10 · open decisions (carried from kickoff §12 + resolved/deferred per flatline-r1)

Inherited from kickoff §12 (all RESOLVED):

| # | decision | resolution |
|---|---|---|
| D1 | cubquests team coord | RESOLVED · operator owns it · proceed autonomously |
| D2 | EVM target chains | RESOLVED · "EVM" IS one adapter · this module ships PORTS not adapters |
| D3 | S4 dogfood world | RESOLVED · compass IS 1/3 dogfood · 2nd-dogfood deferred |
| D4 | cycle-Q resume | RESOLVED · paused · resume post-S3 |
| D5 | Mint naming | RESOLVED · dual-supertype · scope is freeside-mint not this PRD |
| D6 | sealed-schema versioning | TENTATIVE · mirror compass · /architect re-ratifies in SDD §5.6 |

New decisions from PRD r1 (RESOLVED in r2 per flatline-r1):

| # | decision | resolution in r2 |
|---|---|---|
| D7 | Effect.Schema major version pin | DEFERRED to SDD · NFR §5.1 mandates same-major-as-compass |
| D8 | JSON Schema $id namespace canonical form | RESOLVED · `schemas.freeside.thj/<schema>/<version>` (per §5.6 examples) |
| D9 | event-stream durability (who holds canonical event store) | RESOLVED in PRD · FR-11 EventStoreContract · adapters implement |
| D10 | ProgressRecord shape | DEFERRED to SDD §4 port spec |
| D11 | `IdentityId` shape | RESOLVED in PRD · FR-12 · opaque branded + IdentityResolverPort |
| D12 | OnChainEvent VM discriminator | RESOLVED in PRD · FR-3 · `vm: 'evm'|'svm'|'move'|'other'` |
| D13 | MCP manifest publication strategy | DEFERRED to SDD · cross-cuts freeside-mcp-gateway |

New decisions from flatline-r1 (DEFERRED to SDD with explicit revisit policy):

| # | flatline finding | severity | SDD revisit section |
|---|---|---|---|
| D14 | canonicalization scalar encoding (Date · BigInt · Number) | SKP-002 HIGH 760 | SDD §5.6 canonical scalar spec |
| D15 | event_id collision distinguishability (nonce convention) | SKP-002 HIGH 760 | SDD §5.6 nonce-supply policy |
| D16 | MCP authorization · privacy · tenancy · rate-limit | SKP-004 HIGH 735 | SDD §3 MCP-AC requirements |
| D17 | MCP pagination (cursor-based · PaginatedResponse wrapper) | SKP-002 HIGH 750 | SDD §3 pagination |
| D18 | RewardPort fine-grained idempotency adapter contract | SKP-003 HIGH 720 | SDD §4 RewardPort spec |
| D19 | ActivityKind sealed-extension governance (extension SLA + WorldDefined registry) | SKP-001 HIGH 720 | SDD §5 extension-seam governance |
| D20 | raffle PRNG hardening (commit-reveal · VRF · documented v1 limitation) | SKP-003 HIGH 740 + SKP-005 HIGH 720 | SDD §5 raffle randomness OR documented threat-model |

---

## 11 · references

### artifacts produced by this PRD authoring
- this PRD r2 (`grimoires/loa/prd.md`) · flatline-r1 amendment integrated
- updates to `CLAUDE.md` (Loa import line · legacy banner) 2026-05-15
- updates to `.loa.config.yaml` (simstim + flatline + hounfour blocks imported from bonfire) 2026-05-15

### evidence artifacts (read during authoring)
- kickoff: `~/bonfire/grimoires/bonfire/specs/acvp-modules-genesis-kickoff-2026-05-15.md`
- cubquests PRD: `~/Documents/GitHub/cubquests-interface/grimoires/loa/prd.md` (511 lines · sovereign-migration target arch)
- cubquests AGENTS.md: `~/Documents/GitHub/cubquests-interface/AGENTS.md` §1 (Activities-Unification)
- cubquests RAFFLES.md: `~/Documents/GitHub/cubquests-interface/docs/RAFFLES.md`
- cubquests questponzi blog: `~/Documents/GitHub/cubquests-interface/content/blog/questponzi.mdx`
- cubquests badge-merkle: `~/Documents/GitHub/cubquests-interface/lib/blockchain/badge-merkle.ts`
- compass peripheral-events: `~/Documents/GitHub/compass/packages/peripheral-events/CLAUDE.md`
- compass medium-blink: `~/Documents/GitHub/compass/packages/medium-blink/CLAUDE.md`
- compass world-sources: `~/Documents/GitHub/compass/packages/world-sources/CLAUDE.md`
- compass purupuru-anchor: `~/Documents/GitHub/compass/programs/purupuru-anchor/README.md`
- crayons product DNA: `~/Documents/GitHub/crayons-monorepo/docs/crayons-product-principles.md`
- flatline-r1 output: `/tmp/flatline-prd-output.log`

### vault doctrine (active or candidate)
- `~/vault/wiki/concepts/agentic-cryptographically-verifiable-protocol.md` (active · parent)
- `~/vault/wiki/concepts/freeside-modules-as-installables.md` (active)
- `~/vault/wiki/concepts/medium-agnostic-acvp-substrate.md` (candidate · drafted 2026-05-15)
- `~/vault/wiki/concepts/closed-loop-reward-mechanic.md` (candidate · drafted 2026-05-15)
- `~/vault/wiki/concepts/chat-medium-presentation-boundary.md` (active · load-bearing)
- `~/vault/wiki/concepts/mibera-as-npc.md` (active)
- `~/vault/wiki/concepts/schema-is-not-the-contract.md` (active)
- `~/vault/wiki/concepts/contracts-as-bridges.md` (active)

### sibling cycles + post-this-cycle queue
- cycle-Q (bd-3ntx) · discord-renderer · PAUSED (kickoff §13)
- freeside-mint simstim · SEQUENCED · fires after this cycle's S0-S3 close (kickoff §13)
- cubquests-as-module migration · QUEUED (kickoff §14)
- crayons-as-consumer-product-revival · QUEUED (kickoff §14)

---

## 12 · Flatline Round 1 amendment log (2026-05-15 PM)

### 12.1 · summary

Flatline-r1 ran 2026-05-15T01:10:39Z · 184 seconds · $0 cost (cheval-headless subscription routing) · 3 models (claude-opus-4-8 + gpt-5.4-codex + gemini-3.0-pro) · full confidence · 25 findings (7 HC + 6 DISPUTED + 12 BLOCKERS).

### 12.2 · triage decisions (accepted by operator 2026-05-15 PM)

**HIGH_CONSENSUS auto-integrated (7)** — all folded into PRD r2:
- IMP-001 (900): D7-D13 not deferrable → §10 resolved D8/D9/D11/D12 in PRD · D7/D10/D13 explicitly SDD-deferred with revisit
- IMP-002 (900): canonicalization foundational → §5.6 canonical preimage schema + SDD-deferred D14 scalar encoding
- IMP-003 (872): lifecycle state machine → FR-1 lifecycle_state field + CL-Activity-4
- IMP-004 (865): ActivityId derivation load-bearing → §5.6 + FR-1 (SDD §5 finalizes)
- IMP-005 (835): sealed reward dependency on freeside-mint → FR-4 CL-Reward-1 declares MintIntentId as forward-compat REFERENCE
- IMP-006 (782): EventFilter + pagination → CL-MCP-4 + D17 SDD-deferred
- IMP-007 (750): version evolution policy → D6 tentative (mirror compass) · SDD §5.6 ratifies

**DISPUTED accepted (5/6)** — folded into PRD r2:
- IMP-011 (835) accepted: IdentityId opaque branded → FR-12
- IMP-012 (745) accepted: pinned fixture authority → §5.6 golden-vectors/ + measurable criterion
- IMP-013 (720) accepted: extension seam → FR-2 WorldDefined variant
- IMP-014 (765) accepted: sealed port error types → FR-8 ProgressError/EventError/RewardError/IdentityResolverError
- IMP-015 (790) accepted: world binding cross-linked → FR-2 WorldDefined.world_id + FR-12 cross-cuts
- IMP-016 (700) DOWNGRADED: CMP-lint → FR-10 documented convention (NOT CI gate · ports-only package has no user-visible strings)

**BLOCKERS resolved in PRD (4 CRITICAL)** — folded into PRD r2:
- CRITICAL SKP-001 (910) event_id derivation → §5.6 canonical preimage schema with explicit per-event preimage definitions + golden vectors
- CRITICAL SKP-001 (850) async reward failure → FR-4 RewardState state machine (Pending/Granted/Failed)
- CRITICAL SKP-003 (880) event store ordering → FR-11 EventStoreContract (append-only · monotonic · CAS · partition isolation)
- CRITICAL SKP-005 (820) IdentityId load-bearing → FR-12 (opaque branded + IdentityResolverPort)

**BLOCKERS deferred to SDD with explicit revisit (8 HIGH)** — listed in §10 D14-D20:
- HIGH SKP-002 (760) canonicalization scalar encoding → D14 · SDD §5.6
- HIGH SKP-002 (760) event_id collision via nonce → D15 · SDD §5.6 (nonce contract in PRD CL-Event-5 · supply policy in SDD)
- HIGH SKP-004 (735) MCP authorization · privacy · tenancy → D16 · SDD §3
- HIGH SKP-002 (750) MCP pagination → D17 · SDD §3
- HIGH SKP-003 (720) RewardPort fine-grained idempotency → D18 · SDD §4
- HIGH SKP-001 (720) ActivityKind extension governance → D19 · SDD §5 (PRD adds WorldDefined seam · SDD adds governance SLA)
- HIGH SKP-003 (740) raffle PRNG → D20 · SDD §5
- HIGH SKP-005 (720) raffle randomness underspec → D20 · SDD §5

### 12.3 · re-flatline policy

Per operator decision 2026-05-15 PM: triage accepted without re-flatline. Phase 3 (/architect SDD authoring) inherits the resolved PRD + deferred-to-SDD revisit list. SDD authoring MUST address D14-D20 before SDD ratification (Phase 4 flatline SDD will catch if any are missed).

---

## 13 · activation receipt

```text
Activated doctrine sources (this PRD r2 authoring):
  [[agentic-cryptographically-verifiable-protocol]]  — usable · parent
  [[freeside-modules-as-installables]]                — usable · shape constraint
  [[medium-agnostic-acvp-substrate]]                  — usable · candidate
  [[closed-loop-reward-mechanic]]                     — usable · candidate
  [[chat-medium-presentation-boundary]]               — usable · downgraded to convention per IMP-016
  [[mibera-as-npc]]                                   — usable · two-tier
  [[schema-is-not-the-contract]]                      — usable · constraints behavior layer
  [[contracts-as-bridges]]                            — usable · ports as bridges

Evidence-source absorption:
  cubquests-interface grimoires/loa/  — usable · production wisdom
  compass packages/peripheral-events  — usable · reference impl
  compass packages/medium-blink       — usable · surface-adapter pattern
  compass packages/world-sources      — usable · port pattern

Operation: simstim-phase-2-flatline-amendment (PRD r2 authoring · flatline integration)
Use scope: this PRD r2 · cannot decide SDD-deferred items · cannot promote doctrines to active
Boundaries: NO writing application code · NO publishing npm package · /architect inherits revisit list
Expiry: end-of-cycle OR superseded by /architect output OR explicit operator revocation
```

---

## 14 · status

**Draft r2 (post-flatline-round-1).** This PRD was hardened by 3-model adversarial review 2026-05-15. Awaiting:

1. **Phase 3 ARCHITECTURE** — `/architect` produces SDD with concrete component specs · ratifies D14-D20 with concrete designs · MUST address all SDD-deferred items
2. **Phase 4 FLATLINE SDD** — multi-model adversarial review on SDD (cheval-headless · ~$0)
3. **Phase 5 PLANNING** — sprint plan with task breakdown
4. **Phase 6 FLATLINE SPRINT** — adversarial review on sprint plan
5. **Phase 7 IMPLEMENTATION** — /run sprint-plan autonomous execution

Promotion path:
- operator nod → simstim moves to Phase 3 · `/architect` fires with this PRD + kickoff as input
- /architect resolves D14-D20 with concrete specs · adds D21+ as discovered
- Phase 4 flatline catches any deferred items SDD didn't address

---

*The unified Activity supertype — one shape · many kinds (4 built-in + WorldDefined seam) · medium-agnostic · chain-agnostic · ACVP-conformant · hardened by 3-model adversarial review · grounded in years of cubquests production wisdom · proven by compass's 1/3 reference impl · 4 CRITICAL blockers resolved in-PRD · 8 HIGH blockers queued for SDD · ready for /architect.*
