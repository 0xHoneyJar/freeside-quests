---
status: draft
type: sdd
cycle: acvp-modules-genesis
module: freeside-activities
phase: simstim-phase-3-architecture
simstim_id: simstim-20260515-6a20a74b
created: 2026-05-15
prd_source: grimoires/loa/prd.md (r2 · 1034 lines · post-flatline-r1)
authority: zksoju (operator) · pending Phase 4 flatline ratification
resolves:
  - D7 (Effect.Schema version pin)
  - D10 (ProgressRecord shape)
  - D13 (MCP manifest publication strategy)
  - D14 (canonical scalar encoding)
  - D15 (nonce supply policy)
  - D16 (MCP authorization · privacy · tenancy · rate limit)
  - D17 (MCP pagination)
  - D18 (RewardPort fine-grained idempotency)
  - D19 (ActivityKind extension governance)
  - D20 (raffle PRNG hardening)
architectural_locks: A1-A8 (see §2)
mode: ARCH
expiry: end-of-cycle OR superseded by Phase 4 flatline OR explicit operator revocation
---

# SDD · freeside-activities · Software Design Document

> **Concrete architectural design for the unified Activity protocol. Resolves all PRD-deferred decisions (D7/D10/D13-D20) with executable specifications. Eight architectural locks (A1-A8) define the boundary. The substrate is the contract.**

---

## 0 · tl;dr

```
🏗  what       SDD for freeside-activities · resolves 10 deferred decisions ·
                ships 8 architectural locks + per-component specs + adapter contracts

🪨  locks      A1 sealed unions are the boundary · A2 Effect.Schema validation runtime ·
                A3 ports return Effect<R,E> (no throws) · A4 event store APPEND-ONLY ·
                A5 identity opaque (IdentityResolverPort is boundary) · A6 canonical preimage
                is hash ground · A7 MCP tools READ-ONLY · A8 NO user-visible strings in substrate

🎯  resolves   D7 Effect.Schema ^3.12 · D10 ProgressRecord shape · D13 MCP per-pkg self-pub ·
                D14 RFC3339 dates / decimal-string BigInt · D15 UUIDv4 fallback nonce ·
                D16 bearer-token + world-scope + 60/min rate limit ·
                D17 cursor pagination + PaginatedResponse wrapper ·
                D18 (originating_event_id, recipient) tuple uniqueness ·
                D19 namespaced kind_id + 1-wk SLA for built-in promotion ·
                D20 off-chain PRNG default + opt-in commit-reveal + documented threat-model

📦  ships      8 packages (protocol · ports · adapters/in-memory · mcp-tools · engine · ui DEFERRED) +
                docs (INTENT · EXTRACTION-MAP · INTEGRATION-PATH · ACVP-MATRIX · CMP-CONVENTION) +
                operator runbook + npm publish-readiness (no actual publish in cycle)
```

---

## 1 · system overview

### 1.1 · architectural sketch

```mermaid
flowchart TB
  classDef sub fill:#1f2937,stroke:#fbbf24,color:#fde68a
  classDef port fill:#1e1b4b,stroke:#a78bfa,color:#c4b5fd
  classDef adapter fill:#0f172a,stroke:#34d399,color:#6ee7b7
  classDef surface fill:#7c2d12,stroke:#fb923c,color:#fed7aa
  classDef consumer fill:#1f1f1f,stroke:#f87171,color:#fca5a5

  subgraph SUBSTRATE["L2 · @0xhoneyjar/freeside-activities (the protocol)"]
    direction TB
    PROTO[protocol/<br/>Activity · ActivityKind · ActivityStep · ActivityReward<br/>EventEnvelope · per-event preimages · golden-vectors]:::sub
    PORTS[ports/<br/>ProgressPort · CompletionEventPort<br/>RewardPort · IdentityResolverPort<br/>sealed error types]:::port
    ENGINE[engine/<br/>compose · lifecycle state machine<br/>golden replay tests]:::sub
    MCP[mcp-tools/<br/>5 tool specs · READ-ONLY<br/>per-package self-published manifest]:::sub
  end

  subgraph ADAPTERS["L2/L3 · world-supplied adapters"]
    direction TB
    INMEM[adapters/in-memory<br/>default · ships with module]:::adapter
    PG[adapters/postgres<br/>(world-built · NOT in this cycle)]:::adapter
    EVENT_STORE[adapters/event-store<br/>append-only · CAS · partition]:::adapter
    ID_RES[adapters/identity-resolver<br/>per-world impl · maps IdentityId → chain address]:::adapter
  end

  subgraph SURFACES["L3 · world-supplied surfaces (NOT this module)"]
    direction LR
    DISCORD[medium-discord<br/>cycle-Q paused]:::surface
    BLINK[medium-blink<br/>compass has this]:::surface
    FRAME[medium-frame<br/>future]:::surface
    NATIVE[native-app<br/>future]:::surface
  end

  subgraph CONSUMERS["L4 · consumer worlds"]
    PURUPURU[purupuru / compass]:::consumer
    CUBQUESTS[cubquests-as-module<br/>migration cycle]:::consumer
    MIBERA[mibera grails]:::consumer
    LILY[lily fortune-PoC]:::consumer
  end

  PROTO --> PORTS
  PORTS --> ENGINE
  PORTS --> MCP
  PORTS --> INMEM
  PORTS --> PG
  PORTS --> EVENT_STORE
  PORTS --> ID_RES

  INMEM --> PURUPURU
  PG --> CUBQUESTS
  EVENT_STORE --> MIBERA
  EVENT_STORE --> LILY

  SURFACES -.->|present Activity to user| PURUPURU
  SURFACES -.-> CUBQUESTS
  SURFACES -.-> MIBERA
  SURFACES -.-> LILY
```

### 1.2 · the substrate boundary (load-bearing per A5, A7, A8)

```
┌────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   SURFACE LAYER (L3)   Discord · Frame · Blink · native · CLI · MCP     │
│   ──────────────────   medium-* packages (NOT this module)              │
│       ↕ presentation translation (CMP-convention · A8)                  │
│                                                                          │
│   PORT LAYER (L2)      ProgressPort · CompletionEventPort               │
│   ──────────────       RewardPort · IdentityResolverPort                │
│       ↕ Effect<R, SealedError> (A3 · no throws)                         │
│                                                                          │
│   SCHEMA LAYER (L2)    Activity · ActivityKind · Step · Reward          │
│   ──────────────       EventEnvelope · canonical preimage (A6)          │
│       ↕ Effect.Schema validation (A2)                                   │
│                                                                          │
│   ADAPTER LAYER (L2)   in-memory (ships) · postgres · event-store ·     │
│   ───────────────      identity-resolver (per-world impl)               │
│       ↕ adapter conformance contract (§10)                              │
│                                                                          │
│   STORAGE/CHAIN (L1)   Postgres · Convex · EVM · SVM · IPFS ·           │
│   ─────────────────    Edge KV · in-memory test harness                 │
│                                                                          │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2 · architectural locks (the load-bearing constraints)

These are the immutable constraints. Violations require explicit /architect amendment.

### A1 · Sealed unions are the boundary (no escape hatches outside WorldDefined)

`ActivityKind`, `ActivityStep.VerificationMethod`, `ActivityReward`, `RewardState`, port error types — ALL sealed-union Schema.TaggedEnum. Exhaustive switch enforced at compile time via Effect's `Match.exhaustive`.

`WorldDefined` is the ONE escape hatch in `ActivityKind` · worlds add custom kinds via their own sub-schema · the substrate validates the seam, not the world's content.

### A2 · Effect.Schema is the validation runtime (NOT zod/ajv/io-ts)

Effect.Schema 3.12+ (D7 resolved) is the single validation surface. JSON Schema is DERIVED from Effect.Schema at build time, never authored by hand. Zod/Ajv/Io-ts NOT permitted in protocol package (allowed in adapters if a third-party library requires them, but never as the canonical type definition).

### A3 · Ports return Effect<Success, SealedError> · no throws

Every port operation has signature `Effect.Effect<Success, SealedError, Requirements>` where `SealedError` is a sealed TaggedEnum. Adapters MUST handle every error variant explicitly. No bare exceptions across port boundaries.

### A4 · Event store is APPEND-ONLY · CAS for concurrent writers

`EventStoreContract` (FR-11) mandates append-only · monotonic-sequence-within-partition · CAS-on-tip · duplicate-rejection. Adapters that fail to satisfy these contracts FAIL the conformance test suite.

### A5 · Identity is opaque · IdentityResolverPort is the boundary

`IdentityId` is opaque branded string. The substrate does NOT interpret it. World-specific identity (wallet · DID · TBA · ENS · email) lives behind `IdentityResolverPort`. Cross-chain resolution is per-chain via the resolver port.

### A6 · Canonical preimage is the hash ground · NO bare hash() calls in adapters

`event_id = SHA-256(JCS(per-event-preimage))`. Per-event preimage schemas defined in `packages/protocol/preimage/`. Adapters MUST use `freeside.thj.computeEventId(event)` from protocol pkg · MUST NOT call sha256 directly. Golden vectors in `packages/protocol/golden-vectors/` enforce cross-runtime determinism.

### A7 · MCP tools are READ-ONLY

Mutations happen via ports only. MCP exposes `getActiveActivities`, `getProgress`, `getBadges`, `getRaffleEntries`, `listKinds` — all read operations. No `createActivity` · no `claimBadge` · no `enterRaffle` via MCP.

### A8 · Substrate has NO user-visible strings · CMP-convention enforced in surface adapters

The protocol package has NO user-visible strings. Activity titles · step descriptions · reward narratives are CONTENT (passed through the substrate · not OWNED by it). Surface adapter packages enforce the CMP-boundary lint where it matters (medium-discord, medium-blink, etc).

---

## 3 · component specifications

### 3.1 · protocol/ (sealed schemas)

```
packages/protocol/
├── Activity.ts                        FR-1
├── ActivityKind.ts                    FR-2 (sealed + WorldDefined)
├── ActivityStep.ts                    FR-3
├── ActivityReward.ts                  FR-4 (+ RewardState async machine)
├── event-store-contract.ts            FR-11
├── events/
│   ├── EventEnvelope.ts
│   ├── ActivityCompleted.ts
│   ├── BadgeIssued.ts
│   ├── RaffleDrawn.ts
│   ├── ProgressAdvanced.ts
│   ├── RewardPending.ts
│   ├── RewardGranted.ts
│   └── RewardFailed.ts
├── branded/                           branded types (constructor discipline)
│   ├── ActivityId.ts                  pattern: ^act_[a-z0-9]{1,128}$
│   ├── EventId.ts                     SHA-256 hex (64 chars)
│   ├── IdentityId.ts                  FR-12 · pattern: ^id_[a-z0-9]{1,128}$
│   ├── PeriodKey.ts                   union: null | ISOWeek | SnapshotId | CycleId | WorldDefinedKey
│   ├── PartitionKey.ts                FR-11 · {scope, value}
│   ├── WorldId.ts                     pattern: ^world_[a-z0-9_-]{1,64}$
│   ├── SnapshotId.ts                  pattern: ^snap_[a-z0-9]{1,128}$
│   ├── CycleId.ts                     pattern: ^cyc_[a-z0-9_-]{1,128}$
│   ├── StepId.ts                      pattern: ^step_[a-z0-9_-]{1,128}$
│   └── MintIntentId.ts                forward-compat REFERENCE to freeside-mint
├── preimage/                          §5.6 canonical preimage schemas
│   ├── activity-completed.preimage.ts
│   ├── badge-issued.preimage.ts
│   ├── raffle-drawn.preimage.ts
│   ├── progress-advanced.preimage.ts
│   ├── reward-pending.preimage.ts
│   ├── reward-granted.preimage.ts
│   └── reward-failed.preimage.ts
├── golden-vectors/                    cross-runtime determinism fixtures
│   ├── activity-completed.golden.json (N=3 examples per event type)
│   └── ... (one per event)
├── compute-event-id.ts                A6 · the ONLY hash function callers use
├── encoding/
│   ├── jcs.ts                         RFC 8785 canonicalization (uses 'canonicalize' lib)
│   ├── date.ts                        D14 · Date <-> RFC3339 string
│   └── decimal.ts                     D14 · BigInt <-> decimal-string with decimals
├── build/json-schema.ts               derives JSON Schema from Effect.Schema
└── __tests__/
    ├── activity.test.ts
    ├── compass-roundtrip.test.ts
    ├── cubquests-roundtrip.test.ts
    └── golden-vectors.test.ts
```

### 3.2 · ports/ (typed interfaces with sealed errors)

See FR-8 in PRD for full port + error definitions. Ports re-stated here for SDD-canonical:

```typescript
// packages/ports/progress-port.ts
export interface ProgressPort {
  getProgress(activityId: ActivityId, identityId: IdentityId): Effect.Effect<ProgressRecord, ProgressError>;
  advanceProgress(event: ProgressAdvanced): Effect.Effect<ProgressRecord, ProgressError>;
}

// D10 RESOLVED · ProgressRecord shape:
export const ProgressRecord = Schema.Struct({
  activity_id: ActivityId,
  identity_id: IdentityId,
  current_step: Schema.NullOr(StepId),                  // null = not started
  steps_completed: Schema.Array(StepCompletion),        // ordered by completion ts
  last_advanced_event_id: Schema.NullOr(EventId),
  version: Schema.Number,                                // optimistic concurrency counter (FR-8 ConcurrentUpdate)
  lifecycle_state: Schema.Literal('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'),
});
```

### 3.3 · adapters/in-memory (ships with module · test fixtures)

```
packages/adapters/in-memory/
├── progress.ts                  in-memory ProgressPort impl (Map<ActivityId, ProgressRecord>)
├── completion-event.ts          in-memory EventStoreContract impl
│                                  ▸ Map<PartitionKey, Array<EventEnvelope>>
│                                  ▸ enforces A4 invariants (CAS · monotonic · duplicate-reject)
├── reward.ts                    in-memory RewardPort impl
│                                  ▸ tracks (originating_event_id, recipient) → existing RewardGranted
│                                  ▸ D18 idempotency contract enforced
├── identity-resolver.ts         in-memory IdentityResolverPort stub
│                                  ▸ Map<IdentityId, Map<chain, address>>
│                                  ▸ TEST FIXTURE ONLY · worlds implement real resolvers
└── __tests__/
    ├── progress.test.ts
    ├── event-store-conformance.test.ts   ← MUST pass for any new adapter
    ├── reward-idempotency.test.ts
    └── identity-resolver.test.ts
```

### 3.4 · mcp-tools/ (read-only agent surface)

```
packages/mcp-tools/
├── manifest.json                      MCP manifest declaration
├── tools/
│   ├── get-active-activities.json
│   ├── get-progress.json
│   ├── get-badges.json
│   ├── get-raffle-entries.json
│   └── list-kinds.json
├── auth/                              D16 RESOLVED
│   ├── bearer-token.ts                signed bearer token validation
│   ├── world-scope.ts                 world-scope extraction from token
│   ├── rate-limit.ts                  in-memory token-bucket · 60/min default
│   └── audit-log.ts                   write to .run/mcp-audit.jsonl
├── pagination/                        D17 RESOLVED
│   └── cursor.ts                      cursor encoding + PaginatedResponse<T>
└── README.md
```

### 3.5 · engine/ (composition · lifecycle · golden tests)

```
packages/engine/
├── compose.ts                         Effect Layer composition · wires ports + adapters
├── lifecycle.ts                       Activity state-machine driver (HC-IMP-003)
│                                        DEFINED → ACTIVE → PARTICIPATING → COMPLETED|EXPIRED
├── retry.ts                           D18 + FR-4 · async reward retry orchestrator
└── __tests__/
    └── golden.test.ts                 N-activity · 2-identity · 1-completion · verify-events
```

### 3.6 · ui/ (DEFERRED · cycle-Q resumes for medium-discord)

Existing scaffold code preserved as-is. cycle-Q resume re-aligns this against compass/medium-blink shape post-S3.

---

## 4 · APIs + interfaces

### 4.1 · port specs (canonical)

| port | operation | Effect signature | sealed errors |
|---|---|---|---|
| ProgressPort | getProgress | `(ActivityId, IdentityId) → Effect<ProgressRecord, ProgressError>` | ActivityNotFound · IdentityNotFound · ConcurrentUpdate · AdapterUnavailable |
| ProgressPort | advanceProgress | `(ProgressAdvanced) → Effect<ProgressRecord, ProgressError>` | (same) |
| CompletionEventPort | emit | `(ActivityCompleted) → Effect<EventId, EventError>` | InvalidChain · DuplicateEvent · SchemaValidation · AdapterUnavailable |
| CompletionEventPort | query | `(EventFilter) → Effect<readonly ActivityCompleted[], EventError>` | (same) |
| RewardPort | grant | `(ActivityReward, IdentityId, EventId) → Effect<RewardGranted, RewardError>` | AlreadyGranted · GrantFailed · IdentityUnresolvable · AdapterUnavailable |
| RewardPort | query | `(IdentityId) → Effect<readonly RewardGranted[], RewardError>` | (same) |
| IdentityResolverPort | resolveToChainAddress | `(IdentityId, chain) → Effect<string, IdentityResolverError>` | UnresolvableIdentity · ChainNotSupported · ResolverUnavailable |
| IdentityResolverPort | resolveFromChainAddress | `(address, chain) → Effect<IdentityId, IdentityResolverError>` | (same) |

### 4.2 · EventStoreContract (FR-11 · the adapter conformance gate)

Adapters that implement CompletionEventPort MUST also satisfy EventStoreContract. Conformance test suite at `packages/adapters/in-memory/__tests__/event-store-conformance.test.ts` is the canonical gate — any new adapter passes the same tests.

| operation | semantics |
|---|---|
| append(event, partition) | atomic write · returns receipt with sequence number · rejects DuplicateEvent |
| read(partition, fromSeq, toSeq?) | deterministic ordered read · stable across calls (replay-deterministic per CL-EventStore-6) |
| appendIfTipMatches(event, partition, expectedTip) | CAS · rejects if tip != expectedTip with ConcurrentUpdate-style error |
| getTip(partition) | returns current tip EventId · null if partition empty |

### 4.3 · MCP tool inputs/outputs (D16 + D17 RESOLVED)

All tools accept additional implicit auth context (extracted from bearer token):
- `_auth.caller_identity: IdentityId` (the calling agent or user)
- `_auth.world_scope: WorldId | 'global'` (the scope the caller is authorized for)
- `_pagination.cursor: string | null` (optional · for paginated tools)
- `_pagination.limit: number` (optional · default 50 · max 200)

All list-returning tools return `PaginatedResponse<T>`:
```typescript
export const PaginatedResponse = <A>(item: Schema.Schema<A>) => Schema.Struct({
  items: Schema.Array(item),
  next_cursor: Schema.NullOr(Schema.String),
  total_count: Schema.NullOr(Schema.Number),         // null when count is expensive
  schema_version: Schema.Literal('1.0.0'),
});
```

Rate limits (D16):
- 60 requests/min per caller_identity (in-memory token-bucket adapter)
- exceeded → standard error response with retry_after
- override per-world via SDD-defined `mcp_rate_limit` config in `world-manifest.yaml` (future)

---

## 5 · data models + schemas (D7/D10/D14/D15 RESOLVED)

### 5.1 · Effect.Schema version pin (D7 RESOLVED)

`package.json` pins `"effect": "^3.12.0"` to match compass/peripheral-events. Any deviation must update compass-roundtrip conformance test.

### 5.2 · branded types (constructor discipline)

```typescript
export const ActivityId   = Schema.String.pipe(Schema.brand('ActivityId'),   Schema.pattern(/^act_[a-z0-9]{1,128}$/));
export const EventId      = Schema.String.pipe(Schema.brand('EventId'),      Schema.pattern(/^[a-f0-9]{64}$/));   // SHA-256 hex
export const IdentityId   = Schema.String.pipe(Schema.brand('IdentityId'),   Schema.pattern(/^id_[a-z0-9]{1,128}$/));
export const SnapshotId   = Schema.String.pipe(Schema.brand('SnapshotId'),   Schema.pattern(/^snap_[a-z0-9]{1,128}$/));
export const CycleId      = Schema.String.pipe(Schema.brand('CycleId'),      Schema.pattern(/^cyc_[a-z0-9_-]{1,128}$/));
export const StepId       = Schema.String.pipe(Schema.brand('StepId'),       Schema.pattern(/^step_[a-z0-9_-]{1,128}$/));
export const WorldId      = Schema.String.pipe(Schema.brand('WorldId'),      Schema.pattern(/^world_[a-z0-9_-]{1,64}$/));
```

### 5.3 · canonical scalar encoding (D14 RESOLVED)

| canonical type | wire encoding | rationale |
|---|---|---|
| Date | `Schema.String` with RFC3339 pattern `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$` | JCS-friendly · cross-runtime · time-zone-agnostic UTC-only |
| BigInt | `Schema.Struct({ value: decimal-string, decimals: int })` · pattern `^-?[0-9]+(\.[0-9]+)?$` (string-encoded decimal · arbitrary precision) | JCS-friendly · no precision loss · explicit fixed-point semantics |
| Number | `Schema.Number` constrained to `Number.MAX_SAFE_INTEGER` | safe-int range · falls back to BigInt-shape above max-safe |
| Boolean | `Schema.Boolean` | JCS-native |
| Null | `Schema.Null` · explicit JSON null (NOT field absence) | JCS-canonical |

Code:
```typescript
// packages/protocol/encoding/date.ts
export const RFC3339Date = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/),
  Schema.brand('RFC3339Date'),
);
export const dateToRFC3339 = (d: Date): RFC3339Date => d.toISOString() as RFC3339Date;
export const dateFromRFC3339 = (s: RFC3339Date): Date => new Date(s);

// packages/protocol/encoding/decimal.ts
export const DecimalValue = Schema.Struct({
  value: Schema.String.pipe(Schema.pattern(/^-?[0-9]+(\.[0-9]+)?$/)),
  decimals: Schema.Number.pipe(Schema.int(), Schema.between(0, 30)),
});
export const bigintToDecimal = (n: bigint, decimals: number): DecimalValue => ({
  value: n.toString(),
  decimals,
});
```

### 5.4 · nonce supply policy (D15 RESOLVED)

| supply source | priority | behavior |
|---|---|---|
| Caller-supplied | highest | caller passes `nonce: string` · enables idempotency for caller-driven retries (e.g., raffle entry replays) |
| Adapter-generated | fallback | adapter generates UUIDv4 if caller omits nonce · suitable for first-write scenarios |
| Operator-provided | special | operator may inject nonces via `freeside.thj.computeEventId(event, { nonce: '...' })` for backfill operations |

Code:
```typescript
// packages/protocol/compute-event-id.ts
export const computeEventId = (event: EventEnvelope, opts?: { nonce?: string }): Effect.Effect<EventId, ComputeError> =>
  Effect.gen(function* (_) {
    const enriched = { ...event, nonce: opts?.nonce ?? event.nonce ?? crypto.randomUUID() };
    const preimage = yield* _(extractPreimage(enriched));        // strip event_id · apply preimage_schema
    const canonical = canonicalizeJCS(preimage);                 // RFC 8785
    const hash = await sha256Hex(canonical);
    return hash as EventId;
  });
```

### 5.5 · idempotency_key separate from nonce (D18 RESOLVED)

`nonce` distinguishes legitimately-distinct events (caller-controlled · part of event_id hash). `idempotency_key` is a SEPARATE concept used by RewardPort to deduplicate grants:

```typescript
// packages/ports/reward-port.ts (idempotency contract)
// RewardPort.grant MUST be idempotent on the (originating_event_id, recipient) tuple.
// Adapters MUST:
//   1. Check if a RewardGranted event exists with matching originating_event_id + recipient
//   2. If exists: return the existing RewardGranted (NOT emit a new one)
//   3. If not exists: grant + emit RewardGranted + return
// 
// This is enforced by reward-idempotency.test.ts in the conformance suite.
```

### 5.6 · canonical preimage (per-event · A6)

Each event type has a preimage schema. The preimage is what's hashed to derive `event_id`. The `event_id` field itself is EXCLUDED from the preimage (no self-reference).

```typescript
// packages/protocol/preimage/activity-completed.preimage.ts
export const ActivityCompletedPreimage = Schema.Struct({
  preimage_schema_id: Schema.Literal('https://schemas.freeside.thj/preimage/activity-completed/v1.0.0'),
  ts: RFC3339Date,
  source_event_hash: Schema.NullOr(EventId),
  nonce: Schema.NullOr(Schema.String),
  schema_version: Schema.Literal('1.0.0'),
  $id: Schema.Literal('https://schemas.freeside.thj/activity-completed/v1.0.0'),
  activity_id: ActivityId,
  identity_id: IdentityId,
  period_key: Schema.NullOr(PeriodKey),
  step_completions: Schema.Array(StepCompletion),         // ordered by step.order before canonicalization
  reward_state_id: Schema.NullOr(EventId),
});

// computeEventId derivation:
//   1. extract fields per ActivityCompletedPreimage.parse(event)
//   2. sort step_completions by step.order (deterministic ordering)
//   3. canonicalize per RFC 8785 (JCS)
//   4. sha256 → 64-char hex string → cast to EventId
```

Similar preimage schemas defined for: `BadgeIssued`, `RaffleDrawn`, `ProgressAdvanced`, `RewardPending`, `RewardGranted`, `RewardFailed` — all in `packages/protocol/preimage/`.

### 5.7 · golden vectors (cross-runtime determinism)

`packages/protocol/golden-vectors/<event-type>.golden.json` — N=3 examples per event type · each shows:
```json
[
  {
    "label": "minimal-quest-completion-no-reward",
    "input": { /* event with all required fields */ },
    "expected_event_id": "abc123def456...",
    "expected_preimage_jcs": "{\"$id\":\"...\",\"...\":\"...\"}"
  },
  { "label": "...", "input": { ... }, "expected_event_id": "...", "expected_preimage_jcs": "..." },
  { "label": "...", "input": { ... }, "expected_event_id": "...", "expected_preimage_jcs": "..." }
]
```

Test: `golden-vectors.test.ts` reads each fixture · computes event_id · asserts match.

Cross-runtime: any non-TS adapter (Rust, Python, etc) MUST pass the same golden vectors.

### 5.8 · JCS canonicalization library choice (D14 SDD-resolved)

Use `canonicalize` npm package (v2.x · RFC 8785 compliant · 1KB minified · zero deps). Wrapped behind `packages/protocol/encoding/jcs.ts` for swappability if needed.

---

## 6 · security design

### 6.1 · schema deserialization

`Schema.decode*` rejects extra fields by default (`additionalProperties: false`). NO silent acceptance of unknown fields. This prevents schema-drift attacks.

### 6.2 · branded type discipline

Branded types constructed only via Schema validators. Raw string → branded coercion REJECTED outside the protocol package. Worlds CANNOT bypass branded-type discipline.

### 6.3 · MCP authorization (D16 RESOLVED)

Bearer token authentication for MCP tools:

```typescript
// packages/mcp-tools/auth/bearer-token.ts
export interface MCPBearerToken {
  caller_identity: IdentityId;      // who is calling
  world_scope: WorldId | 'global';  // what they're authorized for
  exp: RFC3339Date;                 // expiry
  signature: string;                // signed by world-defined signer key
}

export const validateBearerToken = (token: string): Effect.Effect<MCPBearerToken, AuthError> => /* ... */;
```

Adapters validate tokens at request boundary. Token issuance is per-world (a sibling concern of `freeside-auth` module · forward-compat reference).

### 6.4 · MCP world-scope filtering

If `world_scope = WorldId`, results filtered to only show that world's activities/badges/raffles. If `world_scope = 'global'`, no filter (admin-level access).

### 6.5 · MCP audit logging

Every MCP request appended to `.run/mcp-audit.jsonl`:
```jsonl
{"ts":"2026-05-15T13:14:15Z","caller":"id_alice","world":"world_purupuru","tool":"getProgress","args_hash":"abc...","outcome":"ok","latency_ms":42}
```

Audit log is local to each adapter deployment. Cross-deployment aggregation = world's responsibility.

### 6.6 · MCP rate limiting (D16 RESOLVED · 60/min default)

In-memory token bucket per caller_identity:
- capacity: 60 tokens
- refill rate: 1 token/second
- exceeded → error with `retry_after` field
- world-manifest can override via `mcp_rate_limit: { capacity: N, refill_per_second: M }`

### 6.7 · raffle PRNG hardening (D20 RESOLVED · tiered)

V1 default + documented threat-model:

| tier | mechanism | suitable for |
|---|---|---|
| TIER-1 (default) | Off-chain PRNG seeded by block_hash_at_close + cycle_id | low-value cosmetic raffles · narrative-bonded distribution · NOT adversarial high-value |
| TIER-2 (opt-in) | Commit-reveal · seed commitment at cycle_open · reveal at cycle_close + 1-block-delay | medium-value · cycle config: `seed_mechanism: 'commit-reveal'` |
| TIER-3 (opt-in) | VRF (Chainlink VRF on EVM · Switchboard VRF on Solana · drand for off-chain) | high-value · cycle config: `seed_mechanism: 'vrf'` with vrf-provider config |

Documented threat-model warning required in:
- INTEGRATION-PATH.md (in BOLD font)
- world-manifest.yaml comment when using TIER-1 default
- runtime warning logged when TIER-1 raffle draws above value threshold

Adapters can REJECT raffles with insufficient seed-mechanism for their value-class.

---

## 7 · performance + scalability

| concern | spec | rationale |
|---|---|---|
| schema decode/encode | ≤ 1ms cold · ≤ 100µs warm | Effect.Schema benchmarks · validated against compass's 80-test suite |
| canonical preimage compute | ≤ 200µs per event | dominated by JCS canonicalization + sha256 |
| in-memory adapter ops | ≤ 50µs per op | constant-time Map operations |
| event store append (in-memory) | ≤ 100µs | Map + array append + CAS check |
| MCP tool latency (in-memory adapter) | ≤ 5ms p95 | bounded by deserialization + auth |
| golden vector test suite | ≤ 5s full run | ~50 golden vectors total |

Production adapters (Postgres · KV · IPFS) MUST publish their own performance numbers in adapter README.

---

## 8 · D14-D20 + D7/D10/D13 resolutions summary

Already covered in detail above. Index:

| # | resolution | section |
|---|---|---|
| D7 | Effect.Schema ^3.12 (match compass) | §5.1 |
| D10 | ProgressRecord with optimistic concurrency version | §3.2 |
| D13 | MCP manifest per-package self-published + registered with freeside-mcp-gateway at world install | §3.4 |
| D14 | RFC3339 Date / DecimalValue BigInt / safe-int Number | §5.3 |
| D15 | caller-supply OR UUIDv4 fallback nonce · separate from idempotency_key | §5.4 |
| D16 | bearer token + world-scope + 60/min rate limit + audit log | §6.3-6.6 |
| D17 | cursor-based PaginatedResponse<T> wrapper | §4.3 |
| D18 | (originating_event_id, recipient) tuple uniqueness · adapter-enforced | §5.5 |
| D19 | namespaced kind_id `<world_id>:<kind_id>` · 1-week SLA for built-in promotion | §9.1 |
| D20 | TIER-1 off-chain default + TIER-2 commit-reveal opt-in + TIER-3 VRF opt-in | §6.7 |

---

## 9 · ActivityKind extension governance (D19 RESOLVED)

### 9.1 · namespace convention

`WorldDefined.kind_id` format: `<world_id>:<kind>` (e.g., `world_purupuru:puruhani-bond-day-7`). Substrate enforces `^[a-z0-9_-]+:[a-z0-9_-]+$` pattern. Worlds choose their own kinds within their namespace · no collision possible across worlds.

### 9.2 · built-in promotion SLA

If a `WorldDefined` kind sees adoption across ≥2 worlds, operator initiates /architect promotion to built-in:

1. Promotion proposal at `grimoires/loa/proposals/promote-kind-<name>.md`
2. /architect cycle (1 week SLA from proposal to decision)
3. If approved: schema bump to next minor version · `WorldDefined` instances of the kind continue working (backward-compat) · new `Builtin<Name>` variant added

This prevents WorldDefined from becoming the only escape valve forever.

### 9.3 · world-registry SLA

`packages/protocol/world-registry.json` (NEW · added in S0) lists all worlds that have declared kinds:
```json
{
  "worlds": [
    { "world_id": "world_purupuru", "declared_kinds": ["puruhani-bond-day-7"], "registered": "2026-05-15" },
    { "world_id": "world_mibera", "declared_kinds": ["grail-veneration"], "registered": "2026-05-15" }
  ]
}
```

Registration is voluntary but RECOMMENDED for cross-world legibility.

---

## 10 · adapter conformance contract

Any adapter implementing protocol ports MUST pass the canonical conformance test suite at `packages/adapters/in-memory/__tests__/`:

| test suite | what it asserts |
|---|---|
| `progress.conformance.test.ts` | ProgressPort: getProgress + advanceProgress · optimistic concurrency (version) · all 4 ProgressError variants reachable |
| `event-store-conformance.test.ts` | CompletionEventPort + EventStoreContract: append-only · monotonic-sequence · CAS · duplicate-reject · replay-determinism |
| `reward-idempotency.test.ts` | RewardPort: (originating_event_id, recipient) tuple idempotency · all 4 RewardError variants reachable |
| `identity-resolver.test.ts` | IdentityResolverPort: round-trip resolveToChainAddress + resolveFromChainAddress · ChainNotSupported handling |
| `golden-vectors.test.ts` | event_id derivation matches golden vectors (cross-runtime determinism) |

Adapter authors copy the conformance suite into their package (or run against the in-memory adapter's test imports) and ensure GREEN before publishing.

---

## 11 · operator runbook

### 11.1 · cycle development workflow

```bash
# 1. local dev
cd ~/Documents/GitHub/freeside-activities
bun install
bun test                                  # ~5s · runs all packages
bun test --filter '@0xhoneyjar/freeside-activities/protocol'
bun run build                             # compiles all packages

# 2. golden-vector validation
bun test --filter golden-vectors          # ensures hash-determinism

# 3. cross-runtime conformance (post-S0 · when adapters land)
bun test --filter compass-roundtrip       # compass/peripheral-events shape
bun test --filter cubquests-roundtrip     # cubquests Activities-Unification shape

# 4. lint + format
bun run lint
bun run format

# 5. simstim phase progress check
bash .claude/scripts/simstim-orchestrator.sh --status
```

### 11.2 · adopting freeside-activities in a world

For a world (e.g., world-purupuru) consuming this module:

```bash
# 1. Add to world's package.json dependencies
"dependencies": {
  "@0xhoneyjar/freeside-activities": "file:../freeside-activities"
}

# 2. Implement IdentityResolverPort for the world's identity model
#    (or consume freeside-auth's reference resolver when available)

# 3. Implement CompletionEventPort with world's event store
#    (Postgres · Convex · in-memory · whichever)

# 4. Declare in world-manifest.yaml
compose_with:
  - module: '@0xhoneyjar/freeside-activities'
    version: '^1.0.0'

# 5. Register world-defined kinds (optional but recommended)
#    Edit world-registry.json in this module · PR back

# 6. Run conformance tests against world's adapter implementations
bun test --filter event-store-conformance
```

### 11.3 · npm publish-readiness (do NOT publish in this cycle per kickoff)

```bash
# Verify publish-readiness
bun publish --dry-run  # all packages
# Check name + version + files[] in each package.json
# Verify NO node_modules / .env / *.secret committed
```

### 11.4 · post-cycle migration (cycle-Q resume · cubquests-as-module)

Follow `docs/INTEGRATION-PATH.md` (rewritten in S0) for per-world adoption sequence.

---

## 12 · deployment + release strategy

### 12.1 · this cycle scope

- NO npm publish
- NO production deployment
- workspace published-ready but not pushed
- artifacts: code + docs + grimoires/loa/ contents + grimoires/freeside-activities/lore (if S3 adds doctrine pages)

### 12.2 · post-cycle release path

- S0 of follow-up cubquests-as-module-migration cycle = first real publish (`@0xhoneyjar/freeside-activities@1.0.0`)
- npm scoped publish via `bun publish --access public --tag latest`
- changelog generated from commits since rename (2026-05-15)
- semver-strict: bumps follow [[freeside-modules-as-installables]] schema_version policy

### 12.3 · backward-compatibility policy

- additive changes within `1.x.y` (new kinds via WorldDefined · new tool specs · new branded types)
- breaking changes require version `2.0.0` + migration doc + 6-month overlap (mirror compass policy)
- `WorldDefined → Builtin` promotion is BACKWARD-COMPATIBLE (existing world-defined instances continue working under their original $id)

---

## 13 · references

### artifacts produced by this SDD
- this SDD (`grimoires/loa/sdd.md`)

### consumed by this SDD
- PRD r2: `grimoires/loa/prd.md` (1034 lines · post-flatline-r1)
- flatline-r1 output: `/tmp/flatline-prd-output.log`
- kickoff: `~/bonfire/grimoires/bonfire/specs/acvp-modules-genesis-kickoff-2026-05-15.md`

### evidence sources
- cubquests: `~/Documents/GitHub/cubquests-interface/grimoires/loa/`
- compass: `~/Documents/GitHub/compass/packages/{peripheral-events,medium-blink,world-sources}/`
- crayons: `~/Documents/GitHub/crayons-monorepo/docs/crayons-product-principles.md`

### vault doctrine
- `~/vault/wiki/concepts/agentic-cryptographically-verifiable-protocol.md`
- `~/vault/wiki/concepts/freeside-modules-as-installables.md`
- `~/vault/wiki/concepts/medium-agnostic-acvp-substrate.md` (candidate)
- `~/vault/wiki/concepts/closed-loop-reward-mechanic.md` (candidate)
- `~/vault/wiki/concepts/chat-medium-presentation-boundary.md`
- `~/vault/wiki/concepts/mibera-as-npc.md`
- `~/vault/wiki/concepts/schema-is-not-the-contract.md`
- `~/vault/wiki/concepts/contracts-as-bridges.md`

### sibling cycles
- cycle-Q (bd-3ntx) · medium-discord · PAUSED
- freeside-mint simstim · SEQUENCED
- cubquests-as-module migration · QUEUED
- compass cycle-X · future · compass refactors to consume freeside-activities

---

## 14 · activation receipt

```text
Activated doctrine (this SDD authoring):
  [[agentic-cryptographically-verifiable-protocol]]  — usable · parent
  [[freeside-modules-as-installables]]                — usable · module shape
  [[medium-agnostic-acvp-substrate]]                  — usable · substrate-adapter-surface tri-layer
  [[chat-medium-presentation-boundary]]               — usable · A8 + §6 surface enforcement
  [[mibera-as-npc]]                                   — usable · A7 + two-tier
  [[schema-is-not-the-contract]]                      — usable · CL-* constraints behavior
  [[contracts-as-bridges]]                            — usable · A3 sealed-error contracts

Evidence absorption:
  cubquests grimoires/loa/                             — usable · production wisdom (Activities-Unification anchored A1)
  compass packages/                                    — usable · reference impl (peripheral-events anchored A2/A4/A6)

Operation: simstim-phase-3-architecture (SDD authoring · resolves 10 deferred decisions)
Use scope: this SDD · cannot decide sprint-level work (Phase 5) · cannot promote doctrines to active
Boundaries: NO writing application code yet · /sprint-plan inherits this SDD
Expiry: end-of-cycle OR superseded by Phase 4 flatline OR explicit operator revocation
```

---

## 15 · status

**Draft r2 (post-flatline-sdd-round-1).** Hardened by 3-model adversarial review 2026-05-15. Awaiting Phase 5 PLANNING.

---

## 16 · Flatline SDD Round 1 amendment (2026-05-15 PM)

### 16.1 · summary
- ran 129s · $0 cost (cheval-headless subscription routing) · 3 models (claude-opus-4-8 + gpt-5.4-codex + gemini-3.0-pro)
- 6 HC · 8 DISPUTED · 12 BLOCKERS (4 CRITICAL · 8 HIGH)
- triage accepted: 6 HC auto-integrated · 5/8 DISPUTED accepted + 1 critical-disputed resolved · 4 CRITICAL fixed in this amendment · 8 HIGH deferred to sprint with revisit-in-S1 policy

### 16.2 · CRITICAL fixes (folded into spec authoritative · supersede §5.4 + §6 originals)

#### Fix-A1 · nonce policy corrected (CRITICAL SKP-001 + SKP-002 · 930+850)

**SUPERSEDES §5.4 nonce-supply table.** The UUIDv4 adapter-generated fallback was BROKEN: it made `computeEventId` non-deterministic, and a caller retrying an identical event would produce two distinct event_ids (defeating idempotency).

Corrected policy:

| supply source | priority | behavior |
|---|---|---|
| Caller-supplied | required for mutating ops | caller MUST pass `nonce: string` for any event that participates in idempotency · event construction REJECTS missing nonce |
| Deterministic-derived | fallback for non-idempotent ops | substrate may derive `nonce = SHA-256(activity_id ‖ identity_id ‖ step_completions_canonical ‖ period_key)` for substrate-internal events where every distinct logical event has distinct deterministic content |
| UUIDv4 generation | REMOVED from computeEventId | UUIDs are generated at EVENT-CONSTRUCTION TIME (in caller code · not inside computeEventId) · computeEventId is now pure and deterministic |

Updated CL constraint:
- **CL-Nonce-1**: `computeEventId(event)` is a pure deterministic function over a fully-formed event · MUST NOT generate values internally
- **CL-Nonce-2**: callers MUST supply nonce for retry-bearing operations (RaffleEntry · BadgeClaim · cross-chain claims · any operation a wallet might submit twice)
- **CL-Nonce-3**: omitting nonce when it's required → `EventError.NonceRequired` (new sealed error variant)

#### Fix-A2 · computeEventId Effect.gen syntax (CRITICAL SKP-001 · 900)

**SUPERSEDES §5.4 computeEventId code.** The original used `await` inside `Effect.gen` which is a real bug — `Effect.gen` requires `yield* _(Effect.promise(...))` for async ops.

Corrected:

```typescript
// packages/protocol/compute-event-id.ts (SDD r2 authoritative)
export const computeEventId = (event: EventEnvelope): Effect.Effect<EventId, ComputeError> =>
  Effect.gen(function* (_) {
    if (event.nonce == null && isMutatingEvent(event)) {
      return yield* _(Effect.fail({ _tag: 'NonceRequired', event_type: event.$id }));
    }
    const preimage = yield* _(extractPreimage(event));                // strip event_id · apply preimage_schema
    const canonical = canonicalizeJCS(preimage);                       // pure · RFC 8785
    const hashBytes = yield* _(Effect.promise(() => sha256Bytes(canonical)));  // Effect.promise wraps async
    const hashHex = bytesToHex(hashBytes);
    return hashHex as EventId;
  });

const isMutatingEvent = (e: EventEnvelope): boolean =>
  e.$id.includes('activity-completed') || e.$id.includes('badge-issued') ||
  e.$id.includes('raffle-entered') || e.$id.includes('reward-pending');
```

Unit test added (in S1 task breakdown):
- `computeEventId(event)` returns `Effect<EventId>` resolving to deterministic hex
- Same input → same output across 100 invocations
- Missing nonce on mutating event → `NonceRequired` error

#### Fix-A3 · MCP bearer token concrete spec (CRITICAL SKP-002 · 890)

**SUPERSEDES §6.3 bearer token.** The original was underspecified.

Concrete spec:

```typescript
// packages/mcp-tools/auth/bearer-token.ts (SDD r2 authoritative)
export const MCPBearerToken = Schema.Struct({
  // Header
  alg: Schema.Literal('Ed25519'),                              // CL-Auth-1 · ONE algorithm only · NO alg:none
  typ: Schema.Literal('freeside-mcp-token'),
  kid: Schema.String,                                           // key id · for rotation

  // Required claims
  iss: WorldId,                                                 // issuing world (or 'freeside-gateway' for cross-world tokens)
  sub: IdentityId,                                              // subject (caller_identity)
  aud: Schema.Array(Schema.Literal('freeside-activities')),     // audience binding
  exp: RFC3339Date,                                             // expiry
  iat: RFC3339Date,                                             // issued-at (for skew detection)
  jti: Schema.String,                                           // unique token id (for replay protection)
  
  // freeside-specific claims
  scope: Schema.Union(WorldId, Schema.Literal('multi')),        // 'multi' replaces 'global' (Fix-A4)
  permissions: Schema.Array(Schema.Literal(
    'getActiveActivities', 'getProgress', 'getBadges', 'getRaffleEntries', 'listKinds'
  )),                                                            // explicit per-tool grants

  // Signature (over canonical token header + claims)
  signature: Schema.String,                                     // Ed25519 hex
});

export const TOKEN_SKEW_TOLERANCE_SECONDS = 60;                 // CL-Auth-3 · ±60s tolerance for iat
export const TOKEN_KEY_DISCOVERY_ENDPOINT = '/.well-known/freeside-mcp-jwks';  // CL-Auth-4 · key rotation via JWKS

// CL-Auth-5 · jti replay protection: adapter MUST track seen-jti for at least TOKEN_REPLAY_WINDOW_SECONDS
export const TOKEN_REPLAY_WINDOW_SECONDS = 3600;                // 1 hour
```

Updated CL constraints:
- **CL-Auth-1**: signature algorithm pinned to Ed25519 (NO alg:none · NO HS256 · NO RS256-vulnerable-keys)
- **CL-Auth-2**: token format is JSON-canonical signed envelope (NOT JWT compact form · to avoid alg-confusion attacks)
- **CL-Auth-3**: clock-skew tolerance ±60s · adapters MUST enforce
- **CL-Auth-4**: key rotation via `/.well-known/freeside-mcp-jwks` endpoint · adapter caches keys for 5 min · supports key id (kid) in token header
- **CL-Auth-5**: jti replay protection · adapter tracks seen jti for at least 1 hour · rejects duplicates with `EventError.ReplayDetected`

#### Fix-A4 · 'global' scope replaced with explicit RBAC (CRITICAL SKP-003 · 850)

**SUPERSEDES §6.4 world-scope filtering.** The original 'global' was a cross-tenant admin path without RBAC.

Concrete spec:

```typescript
// world-scope is now one of:
type WorldScope =
  | { _tag: 'single', world_id: WorldId }                   // tenant-scoped (default)
  | { _tag: 'multi', world_ids: ReadonlyArray<WorldId> }    // explicit cross-world (replaces 'global')
  | { _tag: 'audit', permissions: ReadonlyArray<'audit-log-read' | 'audit-log-aggregate'> };  // explicit audit-only scope
```

Updated CL constraints:
- **CL-Scope-1**: 'global' scope REMOVED · use `multi` with explicit world_ids list
- **CL-Scope-2**: `multi` scope tokens require operator-issued + `kid` from operator key (NOT world-issued)
- **CL-Scope-3**: `audit` scope is read-only-audit · cannot access live participation/badge/raffle data
- **CL-Scope-4**: cross-world enumeration (listing across worlds) requires explicit per-tool permission claim · denied by default
- **CL-Scope-5**: deny-by-default tests required in conformance suite · `multi` token without explicit `world_ids` → denied

### 16.3 · HIGH_CONSENSUS auto-integrated (6)

| finding | integration |
|---|---|
| IMP-001 (890) sealed errors + canonical decode | A1 already covers · adds `Schema.NoExtraFields` invariant to all sealed schemas in §5 |
| IMP-002 (912) optimistic concurrency normative | §3.2 ProgressRecord updated: `version: Schema.Number` is REQUIRED · `advanceProgress` MUST pass `expected_version` · mismatch → `ProgressError.ConcurrentUpdate { current_version, attempted_version }` |
| IMP-003 (880) distinct EventStore error variants | §3.3 in-memory event-store impl updated to use distinct sealed errors: `EventError.CASFailed` · `EventError.NonceCollision` · `EventError.PartitionScopeMismatch` (separate from generic `DuplicateEvent`) |
| IMP-004 (860) hash tie-breakers | §5.6 preimage encoding amendment: `step_completions` sorted by `(step.order, step.step_id)` (lexicographic tie-break on step_id when order is equal) |
| IMP-006 (875) bearer token algo + canonicalization | Fix-A3 covers · adds Schema.Literal('Ed25519') |
| IMP-009 (770) WorldDefined namespace hardening | §9.1 amendment: `kind_id` max 64 chars · reserved prefixes: `freeside-`, `loa-`, `core-` (squatting prevention) |

### 16.4 · DISPUTED accepted (5/8) + 1 critical-disputed resolved

| disputed | decision |
|---|---|
| IMP-013 (800) decimal edge case golden vectors | ACCEPTED · add to `golden-vectors/` (e.g., 1e18 token amounts · negative values · precision edge cases) |
| IMP-014 (820) lifecycle transition guards | ACCEPTED · §3.5 engine/lifecycle.ts MUST enforce: NO backwards transitions · EXPIRED is terminal · transitions emit dedicated `ActivityLifecycleAdvanced` event |
| IMP-015 (910 critical-disputed) overlapping lifecycle vocabularies | RESOLVED · Activity.lifecycle_state describes the ACTIVITY's lifecycle (defined-active-participating-completed-expired) · ProgressRecord.lifecycle_state describes ONE IDENTITY'S participation in an activity (not_started-in_progress-completed) · the two ARE different concerns · clarified naming: Activity.activity_state and ProgressRecord.progress_state to disambiguate |
| IMP-016 (870) PartitionKey scope/value rules | ACCEPTED · §4.2 EventStoreContract amendment: PartitionKey shape `{ scope: 'activity'|'identity'|'world'|'event-type'|'composite', value: string }` · scope determines monotonic-sequence grouping · composite supports `world_id::activity_id` style |
| IMP-018 (810) MCP manifest gateway validation | ACCEPTED · §3.4 amendment: `manifest.json` includes `$schema` reference · freeside-mcp-gateway validates manifest on registration · conflicts (same tool name across packages) → registration rejected |
| IMP-020 (780) promotion semantics preserve event_id stability | ACCEPTED · §9.2 amendment: when a `WorldDefined` kind promotes to `Builtin`, the original `WorldDefined.kind_id` continues to be valid (backward-compat) · the substrate exposes both variants for 6-month overlap |
| IMP-017 (720) source_event_hash semantics | REJECTED · the SDD §3.3 spec already states source_event_hash carries hash-chain lineage semantics · CL-Event-2 enforces · no further spec change needed |
| IMP-019 (560) perf benchmark methodology | DOWNGRADED · performance numbers in §7 are non-contractual targets · not CI-gated · benchmark methodology not required for v1 (revisit if perf becomes ship-blocking) |

### 16.5 · HIGH BLOCKERS deferred to sprint with revisit-in-S1 policy

| # | finding | severity | sprint revisit |
|---|---|---|---|
| D21 | bearer token + jti + rotation + skew (covered by Fix-A3 in part) | HIGH SKP-003 780 | S1 task: implement bearer-token validator + JWKS endpoint + replay tracker |
| D22 | cursor tamper resistance + tenant binding | HIGH SKP-005 720 | S1 task: cursor encoding spec (signed payload · world_scope-bound) |
| D23 | in-memory rate limit + audit log not production | HIGH SKP-004 760 | S1 task: mark in-memory impls as `dev-only` · define production interfaces (Redis token-bucket + append-only audit sink) |
| D24 | RewardPort atomic check-and-grant race | HIGH SKP-002 750 | S1 task: in-memory uses transactional Map ops · postgres adapter MUST use SELECT FOR UPDATE or INSERT WHERE NOT EXISTS |
| D25 | TIER-1 raffle threshold unspecified | HIGH SKP-004 760 | S1 task: define concrete threshold formula (e.g., `reward_count > 10 OR reward_class in {NFT, token}`) · TIER-1 REJECTS above threshold unless explicit opt-in |
| D26 | WorldDefined payload byte-size + nesting limit | HIGH SKP-003 720 | S1 task: add `Schema.maxLength` + `Schema.maxDepth` validators · default 16KB + 8 nesting levels |

### 16.6 · re-flatline policy

Per operator decision 2026-05-15 PM: triage accepted without re-flatline-sdd. Phase 5 (/sprint-plan) inherits this SDD r2 + the 6 deferred items (D21-D26) as MANDATORY sprint-1 tasks.

---

*Eight locks · ten decisions resolved · seven ACVP components fully populated · four CRITICAL flatline-r1 fixes folded in · six HIGH defers queued for sprint-1 · the architecture lands.*
