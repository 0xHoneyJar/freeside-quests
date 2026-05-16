# ACVP-MATRIX — the 7-component reference for `freeside-activities`

> **ACVP** = Agentic Cryptographically-Verifiable Protocol — *agents reason, substrate
> verifies, hashes prove, events trace, tests bind*. This file is the canonical mapping
> of each ACVP component to its concrete artifact in this module.
>
> Parent doctrine: `[[agentic-cryptographically-verifiable-protocol]]` (in operator vault)
> Companion module: `freeside-mint` (NFT-mint factory protocol — symmetric ACVP instance)

---

## The 7 components

ACVP makes 7 component-level guarantees. Each row below names the substrate, the test
that binds it, and the schema/file proving it exists.

| # | Component | What it guarantees | This module's artifact |
|---|---|---|---|
| 1 | **Reality** | The substrate models a real-world domain with explicit boundaries | `Activity` supertype + `ActivityKind` sealed union (FR-1, FR-2) |
| 2 | **Contracts** | Behavior + invariants are first-class — schemas describe shape, contracts include behavior | `EventStoreContract` (FR-11) + typed ports (FR-8) |
| 3 | **Schemas** | Wire-format is sealed · cross-runtime decodable · version-pinned | Effect.Schema + JSON Schema · 21 golden vectors |
| 4 | **State machines** | Transitions are explicit · sealed · backwards-illegal | `ActivityLifecycle` + `RewardState` (FR-4) |
| 5 | **Events** | Every state mutation emits an event · events are content-addressable | 7 event types under `EventEnvelope` (FR-5) |
| 6 | **Hashes** | `event_id = SHA-256(canonical preimage)` · golden vectors prove cross-runtime identity | `computeEventId` (Fix-A1 + Fix-A2) + 21 golden vectors |
| 7 | **Tests** | The substrate enforces 7 cross-component invariants + 5+ per-component invariants | 648 workspace tests + 18 adapter conformance scenarios |

---

## Component 1 · Reality

### Reality modeled

The activities substrate models **identity-bound participation records** — the verifiable
record that a particular `IdentityId` performed a particular `Activity` (quest · mission ·
badge-claim · raffle-entry · world-defined extension).

### Reality artifacts

| Concept | File | Schema $id |
|---|---|---|
| Activity supertype | `packages/protocol/src/activity/Activity.ts` | `https://schemas.freeside.thj/activity/v1.0.0` |
| ActivityKind sealed union | `packages/protocol/src/activity/ActivityKind.ts` | (discriminator in Activity) |
| WorldDefined extension seam | `packages/protocol/src/activity/ActivityKind.ts` (WorldDefinedKindId brand) | `<world>:<kind>` |
| ActivityStep | `packages/protocol/src/activity/ActivityStep.ts` | (embedded in Activity) |
| VerificationMethod sealed union | `packages/protocol/src/activity/ActivityStep.ts` | 6 variants: ManualCurator · SignedMemoTx · MerkleProof · WebhookHmac · PartnerApi · OnChainEvent |

### Tests binding

| Test | File |
|---|---|
| `ActivityKind` rejects reserved-prefix WorldDefined ids | `packages/protocol/src/activity/activity.test.ts:257-265` |
| `Activity` schema decodes the canonical $id literal only | `packages/protocol/src/activity/activity.test.ts` |
| All 6 VerificationMethod variants reachable | `packages/protocol/src/activity/step.test.ts` |

---

## Component 2 · Contracts

Per `[[schema-is-not-the-contract]]` doctrine: schemas describe SHAPE; contracts include
BEHAVIOR + INVARIANTS. This module ships both.

### Contracts shipped

| Contract | File | Invariants enforced |
|---|---|---|
| `EventStoreContract` | `packages/protocol/src/ports/EventStoreContract.ts` | CL-EventStore-1..7 + Fix-A1 (8 invariants — see Component 7) |
| `ProgressPort` | `packages/protocol/src/ports/ProgressPort.ts` | CL-Port-1..2 + CL-Progress-1 (optimistic concurrency) |
| `CompletionEventPort` | `packages/protocol/src/ports/CompletionEventPort.ts` | CL-Port-1..2 + Event-completeness (CL-Event-1) |
| `RewardPort` | `packages/protocol/src/ports/RewardPort.ts` | CL-Port-1..2 + CL-Reward-1..3 + D18 idempotency-by-tuple |
| `IdentityResolverPort` | `packages/protocol/src/ports/IdentityResolverPort.ts` | CL-Port-1..2 + CL-Identity-3..4 (multi-chain + reverse consistency) |
| `KeyProviderPort` | `packages/protocol/src/auth-ports/KeyProviderPort.ts` | Rotation tri-state (active/grace/revoked) |
| `AuthReplayStore` | `packages/protocol/src/auth-ports/AuthReplayStore.ts` | Atomic record-and-check (production: Redis SETEX) |

### Contract conformance suites

| Suite | File | Production adapter conformance |
|---|---|---|
| EventStoreContract conformance | `packages/adapters/src/conformance/event-store-conformance.ts` | 13 tests · MUST pass for postgres + convex + any new adapter |
| RewardPort conformance | `packages/adapters/src/conformance/reward-port-conformance.ts` | 5 tests · MUST pass for any new adapter |
| postgres stubs (`.skip` until adapter lands) | `packages/adapters/src/postgres/__tests__/` | Wire factory + activate when implementing |

---

## Component 3 · Schemas

### Wire-format schemas (sealed · cross-runtime)

| Event type | File | $id |
|---|---|---|
| `ActivityCompleted` | `packages/protocol/src/events/ActivityCompleted.ts` | `https://schemas.freeside.thj/activity-completed/v1.0.0` |
| `BadgeIssued` | `packages/protocol/src/events/BadgeIssued.ts` | `https://schemas.freeside.thj/badge-issued/v1.0.0` |
| `RaffleDrawn` | `packages/protocol/src/events/RaffleDrawn.ts` | `https://schemas.freeside.thj/raffle-drawn/v1.0.0` |
| `ProgressAdvanced` | `packages/protocol/src/events/ProgressAdvanced.ts` | `https://schemas.freeside.thj/progress-advanced/v1.0.0` |
| `RewardPendingEvent` | `packages/protocol/src/events/RewardPendingEvent.ts` | `https://schemas.freeside.thj/reward-pending/v1.0.0` |
| `RewardGrantedEvent` | `packages/protocol/src/events/RewardGrantedEvent.ts` | `https://schemas.freeside.thj/reward-granted/v1.0.0` |
| `RewardFailedEvent` | `packages/protocol/src/events/RewardFailedEvent.ts` | `https://schemas.freeside.thj/reward-failed/v1.0.0` |

### Per-event canonical preimage schemas

| Preimage | File |
|---|---|
| `ActivityCompletedPreimage` | `packages/protocol/src/preimage/ActivityCompletedPreimage.ts` |
| `BadgeIssuedPreimage` | `packages/protocol/src/preimage/BadgeIssuedPreimage.ts` |
| `RaffleDrawnPreimage` | `packages/protocol/src/preimage/RaffleDrawnPreimage.ts` |
| `ProgressAdvancedPreimage` | `packages/protocol/src/preimage/ProgressAdvancedPreimage.ts` |
| `RewardPendingPreimage` | `packages/protocol/src/preimage/RewardPendingPreimage.ts` |
| `RewardGrantedPreimage` | `packages/protocol/src/preimage/RewardGrantedPreimage.ts` |
| `RewardFailedPreimage` | `packages/protocol/src/preimage/RewardFailedPreimage.ts` |

Preimages are events with `event_id` field STRIPPED (the self-reference is the only
field excluded from canonical-preimage computation, per §5.6).

---

## Component 4 · State machines

### `ActivityLifecycle` (per-activity)

```
DEFINED → ACTIVE → PARTICIPATING → COMPLETED
                              ↘ EXPIRED (terminal)
```

| Transition | Legal | Test |
|---|---|---|
| DEFINED → ACTIVE | ✓ | `packages/engine/src/activities/__tests__/lifecycle.test.ts:14-32` |
| ACTIVE → PARTICIPATING | ✓ | (same) |
| ACTIVE → EXPIRED | ✓ | (same) |
| PARTICIPATING → COMPLETED | ✓ | (same) |
| PARTICIPATING → EXPIRED | ✓ | (same) |
| Any backwards transition | ✗ → `InvalidTransition` | `lifecycle.test.ts:34-56` |
| COMPLETED → anything | ✗ → `TerminalState` | `lifecycle.test.ts:60-67` |
| EXPIRED → anything | ✗ → `TerminalState` | (same) |

Per **IMP-006** amendment: `ActivityLifecycleAdvanced` is an INTERNAL signal — NOT a
public EventEnvelope. The cross-cutting lifecycle stream is `ProgressRecord.lifecycle_state`
snapshots queried via `getProgress`.

### `RewardState` (per-reward · async machine)

```
RewardPending → RewardGranted                (success)
RewardPending → RewardFailed (retryable=true)  → RewardPending  (retry loop)
RewardPending → RewardFailed (retryable=false)               (terminal)
```

| File | Test |
|---|---|
| State machine driver: `packages/engine/src/activities/retry.ts` | `packages/engine/src/activities/__tests__/retry.test.ts` |
| RewardState schema: `packages/protocol/src/activity/ActivityReward.ts` | `packages/protocol/src/activity/reward.test.ts` |

### `ProgressLifecycleState` (per-(activity, identity))

```
NOT_STARTED → IN_PROGRESS → COMPLETED
```

Distinct from Activity lifecycle per **IMP-015** (a per-identity state, NOT a per-activity
state). Driven by `ProgressAdvanced` events flowing through `ProgressPort.advanceProgress`.

---

## Component 5 · Events

### Hash-chain continuity (CL-Event-2)

Every event carries `source_event_hash: EventId | null` — null for root events, set to
the prior event's `event_id` for chained events. The chain threads through:

```
ActivityCompleted (root · source_event_hash = null)
  → RewardPendingEvent (source = ActivityCompleted.event_id)
    → RewardGrantedEvent (source = RewardPendingEvent.event_id)
       OR
    → RewardFailedEvent (source = RewardPendingEvent.event_id)
       → RewardPendingEvent (retry · source = RewardFailedEvent.event_id)
```

### EventEnvelope (the shared shape)

All 7 event types extend the shared envelope shape at `packages/protocol/src/events/EventEnvelope.ts`:

| Field | Purpose |
|---|---|
| `event_id` | SHA-256(canonical preimage) · 64-char lowercase hex |
| `preimage_schema_id` | Pinned literal · which preimage schema decodes this event |
| `ts` | RFC 3339 UTC `Z` · per-event timestamp |
| `source_event_hash` | Hash-chain link (CL-Event-2) |
| `nonce` | Caller-supplied (mutating events · Fix-A1) OR derived (non-mutating events) |
| `schema_version` | Literal `"1.0.0"` |
| `$id` | Pinned literal · which event type schema decodes this event |

### Event-completeness invariant (CL-Event-1)

> No `Activity` may transition state without an emitted `CompletionEvent`.

Enforced by:
- Engine composition root yields `CompletionEventPort.emit` BEFORE any lifecycle advance
- Adapter conformance suite asserts append-only (no skip-emit paths)

---

## Component 6 · Hashes

### `computeEventId` — the ONE hash authority (A6)

`packages/protocol/src/events/compute-event-id.ts:93-127`

Algorithm:
1. Reject if `isMutatingEvent(event) && nonce == null` → `NonceRequired` (Fix-A1)
2. Strip `event_id` field from preimage (§5.6 — the only self-reference excluded)
3. Sort `step_completions` by `(order, step_id)` lex (§5.6 tie-break rule)
4. RFC 8785 canonicalize via `canonicalizeJCS` (one third-party call site · `canonicalize` npm pkg)
5. SHA-256 the canonical bytes → 64-char lowercase hex

### Golden vectors — cross-runtime determinism gate

21 fixtures at `packages/protocol/src/golden-vectors/` (3 per event type × 7 event types).
Each fixture is:
- An input (preimage-shape data structure)
- A locked `expected_event_id` (SHA-256 of canonical-JCS)
- A locked `expected_canonical_jcs` (the byte-exact serialized preimage)

Re-derivation gate: any compliant implementation in any language MUST produce identical
output. Test at `packages/protocol/src/golden-vectors/golden-vectors.test.ts` runs all 21
fixtures + asserts 10-invocation determinism per vector.

Decimal edge cases covered (per IMP-013):
- RewardPending with `amount = 1` (1 wei)
- RewardPending with `amount = 2^256 - 1` (256-bit max)
- RewardFailed sanction TokenAmount with negative-via-DecimalValue

---

## Component 7 · Tests + the 7 cross-component invariants

### Cross-component invariants (8 in total · 7 ACVP + 1 Fix-A1)

| ID | Invariant | Enforced by |
|---|---|---|
| **CL-EventStore-1** | APPEND-ONLY: no update/delete · CAS only | `EventStoreContract.append` (no mutate API) |
| **CL-EventStore-2** | Monotonic-sequence per partition | `tipSequenceByEventId` map at append time |
| **CL-EventStore-3** | CAS via `expected_tip_hash` · concurrent writers · exactly-one wins | `append` rejects with `CASFailed` on mismatch |
| **CL-EventStore-4** | Duplicate-reject by `event_id` | `eventIds: Set<EventId>` lookup |
| **CL-EventStore-5** | `partition_key.scope` mismatch rejection | `requireMatchingScope` check |
| **CL-EventStore-6** | Replay-determinism · `read()` stable across calls | `state.events.slice()` returns the same order |
| **CL-EventStore-7** | Nonce-mediated collision · same payload + distinct nonce → both accepted | `computeEventId` includes nonce in preimage |
| **Fix-A1** | Mutating events without nonce rejected at substrate boundary AND adapter boundary | `computeEventId` rejects + `append` rejects |

### Per-component invariants

| Component | Invariant set | File |
|---|---|---|
| Port discipline | CL-Port-1 (Effect-returning · never throw) + CL-Port-2 (every variant reachable) | All 4 ports at `packages/protocol/src/ports/*Port.ts` |
| Identity | CL-Identity-3 (multi-chain per identity) + CL-Identity-4 (reverse consistency) | `IdentityResolverPort.ts` |
| Reward | CL-Reward-1..3 (always-emit-Pending-first · idempotent · hash-chained) + D18 idempotency-by-tuple | `RewardPort.ts` |
| Progress | CL-Progress-1 (optimistic-concurrency-safe) | `ProgressPort.ts` |
| Auth | CL-Auth-1..5 (Ed25519-only · jti replay · skew tolerance · JWKS discovery · ±60s) | `BearerToken.ts` |
| Scope | CL-Scope-1..5 (sealed union · deny-by-default · audit-global) | `WorldScope.ts` |

### Test totals (per sprint)

| Sprint | Packages | Tests added | Workspace total |
|---|---|---|---|
| Sprint-1 | protocol | 475 | 475 |
| Sprint-2 | adapters + engine + mcp-tools | 137 | 612 |
| Sprint-2 round-2 (review fix) | conformance suites + key-rotation tests | +34 | 646 (+2 skipped postgres stubs) |
| **Total (post-audit)** | | | **648 (646 passed + 2 skipped)** |

---

## How to verify the substrate enforces ACVP

Run this single command from the repo root:

```bash
bunx vitest run
# expect: 646 passed | 2 skipped (40 test files · 0 regressions)
```

Each test corresponds to one or more ACVP invariants. Failures map to specific
guarantees breaking — see the per-test docstring for which invariant.

---

## Reference

- Parent doctrine: `[[agentic-cryptographically-verifiable-protocol]]` (vault)
- Sister application: `[[agentic-game-infrastructure]]` (vault · first named ACVP application)
- Meta-observation candidate: `[[loa-as-acvp-infrastructure]]` (vault)
- Companion module: `freeside-mint` (NFT-mint factory · symmetric ACVP instance)
- Spec: `grimoires/loa/{prd,sdd,sprint}.md`
- Cycle close artifacts: `grimoires/loa/a2a/sprint-{1,2}/COMPLETED`
- Audit: `grimoires/loa/a2a/audits/2026-05-16/SECURITY-AUDIT-REPORT.md`
