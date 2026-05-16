# EXTRACTION-MAP — what `freeside-activities` extracts from cubquests + compass

> Renamed from `freeside-quests` 2026-05-15. This map is the per-package evidence trail
> for what each package in this module corresponds to in the source-of-record codebases.
> The acvp-modules-genesis cycle delivered the **SHAPE** here; concrete migration of
> cubquests-interface to consume this module is **cycle-Q resume work** (separate).

## Sources of record

| Source | Role | Status |
|---|---|---|
| `cubquests-interface` (`~/Documents/GitHub/cubquests-interface`) | The production CubQuests Next.js app · canonical operator surface · ~10K+ users · years of production validation | STAYS canonical · this module owns SHAPE only |
| `compass-cycle-1` (`~/Documents/GitHub/compass-cycle-1`) + `compass` (`~/Documents/GitHub/compass`) | Reference implementation of the typed-port + golden-vector + adapter-conformance discipline | Reference impl · this module inherits patterns |
| `crayons-monorepo` (operator's earlier design artifact) | Mint-side prior art (lives in `freeside-mint` extraction map, NOT here) | Companion module |

## packages/protocol/ — sealed schemas + branded types + canonical preimage

| Source | This module | Evidence (file · concept) |
|---|---|---|
| `cubquests-interface/AGENTS.md §1` Activities-Unification | `packages/protocol/src/activity/Activity.ts` + `ActivityKind.ts` | `kind: 'quest' \| 'mission' \| 'badge-claim' \| 'raffle-entry'` discriminant; `period_key` time-axis (null = quest, ISO-week = mission) — the design-decision-IS-the-doc captured here |
| `cubquests-interface/AGENTS.md §1` `user_activity_progress` table shape | `packages/protocol/src/ports/ProgressRecord.ts` | `version`-counter for optimistic concurrency; `steps_completed[]` ordered by completion ts; `lifecycle_state: NOT_STARTED \| IN_PROGRESS \| COMPLETED` — extracted as the per-(activity, identity) state shape |
| `cubquests-interface/lib/process-quests.ts` (quest completion criteria) | `packages/protocol/src/activity/ActivityStep.ts` + `VerificationMethod.ts` | 6 verification variants (manual-curator · signed-memo-tx · merkle-proof · webhook-hmac · partner-api · on-chain-event) extracted from cubquests' various completion checkers |
| `cubquests-interface/lib/blockchain/badge-merkle.ts` + `lib/badge-snapshot/generator.ts` | `packages/protocol/src/events/BadgeIssued.ts` + future `BadgeClaim` Activity kind shape | Off-chain daily snapshot → IPFS merkle root → on-chain claim pattern — formalized as event shape · doctrine in `[[merkle-snapshot-claim-pattern]]` |
| `cubquests-interface/lib/resource-raffles/` (scheduler · provision · utils · raffle-tags) | `packages/protocol/src/events/RaffleDrawn.ts` + future `RaffleEntry` Activity kind shape | Weighted cumulative-walk over user×ticket pairs · idempotent Postgres RPC · 3-state machine — formalized as event shape · doctrine in `[[weighted-raffle-draw-pattern]]` |
| `cubquests-interface/lib/types.ts` (Quest/Badge/Raffle types) | `packages/protocol/src/branded/` (14 branded types) | Branded ActivityId · IdentityId · EventId · StepId · WorldId · MintIntentId · TokenId · CosmeticId · CycleId · PartitionKey · PartnerId · PeriodKey · WorldDefinedKey · SnapshotId |
| `compass/packages/peripheral-events/src/event-id.ts` | `packages/protocol/src/events/compute-event-id.ts` | RFC 8785 JCS canonicalization → SHA-256 event_id derivation pattern; `step_completions` sorted by `(order, step_id)` tie-break · NO UUIDv4 fallback (Fix-A2) |
| `compass/packages/peripheral-events/src/world-event.ts` | `packages/protocol/src/events/EventEnvelope.ts` | Common-shape projection · `event_id` · `preimage_schema_id` · `ts` · `source_event_hash` · `nonce` · `schema_version` · `$id` · CL-Event-1..5 invariants |
| `compass/packages/peripheral-events/tests/event-id.test.ts` | `packages/protocol/src/golden-vectors/` (21 fixtures · 3 per event-type × 7 types) | Cross-runtime determinism gate — every implementation in any language produces identical hashes for identical inputs |
| `compass/packages/peripheral-events/src/stone-claimed.ts` (CardCommitted invariant) | `packages/protocol/src/events/EventError.ts` (CL-EventStore-1..7) + `EventStoreContract.ts` | Compass-cycle-1's CardCommitted double-emit lesson (P18 in construct-fagan) → CAS + monotonic-sequence + duplicate-reject invariants codified |

## packages/ports/ → `packages/protocol/src/ports/`

Co-located in protocol package for single-package simplicity (sprint-1 cycle-5 decision · see NOTES.md Decision Log).

| Source | This module | Evidence |
|---|---|---|
| `cubquests-interface/lib/clients/supabase-admin.ts` + `actions/cached-queries.ts` | `ProgressPort` (`packages/protocol/src/ports/ProgressPort.ts`) | `getProgress(activityId, identityId) → Effect<ProgressRecord, ProgressError>` + `advanceProgress(event) → Effect<ProgressRecord, ProgressError>` · 4-variant sealed `ProgressError` |
| `cubquests-interface/app/api/platform/activities/[slug]/route.ts` (implied event emission) | `CompletionEventPort` + `EventStoreContract` | `emit(ActivityCompleted) → Effect<EventId, EventError>` · `append(event, AppendOptions) → Effect<TipDescriptor, EventError>` (CAS via `expected_tip_hash`) |
| `cubquests-interface/lib/badges.ts` reward issuance | `RewardPort` (`packages/protocol/src/ports/RewardPort.ts`) | `grant(reward, recipient, originatingEventId) → Effect<RewardGranted, RewardError>` · D18 idempotency-by-tuple |
| `cubquests-interface/lib/clients/privy.ts` (implied identity resolution) | `IdentityResolverPort` (`packages/protocol/src/ports/IdentityResolverPort.ts`) | `resolveToChainAddress(identity, chain) → Effect<ChainAddress, IdentityResolverError>` · A5 substrate boundary |

## packages/auth-ports/ — production seams (sprint-2 round-2 additions)

| Concern | This module | Evidence |
|---|---|---|
| Key rotation (production) | `packages/protocol/src/auth-ports/KeyProviderPort.ts` | active · grace · revoked tri-state · sealed errors (KidNotFound · KeyExpired · KeyRevoked · KeyProviderUnavailable) — production worlds plug JWKS / Vault / KMS |
| jti replay (production) | `packages/protocol/src/auth-ports/AuthReplayStore.ts` | Effect-returning `record(jti, nowMs) → Effect<RecordOutcome, ReplayStoreError>` — production wraps Redis SETEX |

## packages/adapters/ — in-memory TEST/DEV fixtures

| Concept | This module | Notes |
|---|---|---|
| ProgressPort in-memory | `packages/adapters/src/in-memory/progress.ts` | Map<recordKey, ProgressRecord> · optimistic-concurrency check · all 4 error variants reachable |
| EventStoreContract + CompletionEventPort in-memory | `packages/adapters/src/in-memory/completion-event.ts` | Map<PartitionKey, EventEnvelope[]> + eventIds Set + tipSequenceByEventId · CL-EventStore-1..7 + Fix-A1 nonce enforcement |
| RewardPort in-memory | `packages/adapters/src/in-memory/reward.ts` | (originating_event_id, recipient) tuple uniqueness · D18 idempotency · all 4 error variants reachable · failingGrants hook for FR-4.2 retry model |
| IdentityResolverPort in-memory | `packages/adapters/src/in-memory/identity-resolver.ts` | TEST-FIXTURE-ONLY (documented at construction · A5) · bind-conflict detection · forward+reverse roundtrip guaranteed |
| Conformance suites (factory-shaped) | `packages/adapters/src/conformance/{event-store,reward-port}-conformance.ts` | Same `describe`/`it` blocks run against in-memory + postgres + convex — adapters supply a factory; postgres-stubs at `packages/adapters/src/postgres/__tests__/*.skip` until adapter lands |
| KeyProvider in-memory (TEST fixture) | `packages/mcp-tools/src/auth/in-memory-key-provider.ts` | active/grace/revoked tri-state simulation · forceUnavailable + failClosedOnNonActive knobs |

## packages/mcp-tools/ — read-only agent surface

| Source | This module | Evidence |
|---|---|---|
| (new for this cycle) | `packages/mcp-tools/manifest.json` + `tools/*.json` × 5 | Bearer-token auth · 5 tools: get-active-activities · get-progress · get-badges · get-raffle-entries · list-kinds |
| (new for this cycle) | `packages/mcp-tools/src/auth/bearer-token.ts` | 6-step validator (schema decode → signature → time bounds → world scope → tool RBAC → jti replay) · Fix-A3 (alg pin) + Fix-A4 (world scope) + IMP-005 (rotation tests) |
| (new for this cycle) | `packages/mcp-tools/src/auth/rate-limit.ts` | Per-caller token bucket · 60 capacity + 1/s refill default · production seam: `RateLimiter` interface |
| (new for this cycle) | `packages/mcp-tools/src/auth/audit-log.ts` | Append-only structured log · 8 outcome variants · production seam: `appendOnlyJsonlSinkSpec` |
| `cubquests-interface/lib/utils.ts` (pagination patterns · implied) | `packages/mcp-tools/src/pagination/cursor.ts` | Signed cursor with RFC 8785 JCS canonical preimage · Web Crypto HMAC-SHA256 (in-memory · production swaps Ed25519) |
| `cubquests-interface/lib/resource-raffles/scheduler.ts` (raffle config) | `packages/mcp-tools/src/raffle-threshold.ts` | TIER-1 threshold gate (`reward_count > 10 OR class ∈ {NFT, token}`) — D25 resolved |

## packages/engine/ — composition + state machines

| Source | This module | Evidence |
|---|---|---|
| (new · Effect Layer pattern) | `packages/engine/src/activities/compose.ts` | `buildDefaultActivitiesLayer` wires all 4 port Tags to in-memory adapters · world override via `Layer.merge` |
| (new · 4 cross-pack Tag identity strings) | `packages/engine/src/activities/ports.ts` | LOAD-BEARING constants per A2: `@0xhoneyjar/freeside-activities/{ProgressPort,CompletionEventPort,RewardPort,IdentityResolverPort}` |
| Implicit in cubquests progress lifecycle | `packages/engine/src/activities/lifecycle.ts` | DEFINED → ACTIVE → PARTICIPATING → COMPLETED/EXPIRED state machine · no backwards · EXPIRED terminal · IMP-006 (ActivityLifecycleAdvanced is INTERNAL signal) |
| Reward async-grant retry pattern | `packages/engine/src/activities/retry.ts` | Exponential backoff · D18 AlreadyGranted short-circuit · pluggable RewardPort · retryable/terminal classification per FR-4.2 |
| Golden replay determinism gate | `packages/engine/src/activities/__tests__/golden.test.ts` | 3 activities + 2 identities + 2 completions + 2 rewards · 10-run byte-identity assertion |

## packages/ui/ — DEFERRED

Existing scaffold code (`QuestCard`, `BadgeShowcase`, `ProgressTracker`, `QuestDetailEmbed`, `VerdictReveal`) **preserved as-is** per SDD §3.6. Cycle-Q resume re-aligns this surface against compass/medium-blink shape after sprint-3 lands the protocol surface.

| Source | This module | Status |
|---|---|---|
| `cubquests-interface/components/` quest-specific UI | `packages/ui/src/` (existing scaffold) | DEFERRED — cycle-Q resume work · post-sprint-3 |
| `cubquests-interface/components/badges/` | `packages/ui/src/BadgeShowcase.tsx` (existing scaffold) | DEFERRED |

## What does NOT extract (per kickoff §2.1 WHAT IT IS NOT)

| Concern | Owned by | Why not here |
|---|---|---|
| The CubQuests operator dashboard surface | `cubquests-interface` (canonical CM surface) | STAYS · this module owns SHAPE not IMPL |
| Quest CONTENT (actual authored quests) | cubquests' Postgres DB | Stays in CubQuests — this module provides typed access via ports |
| Partner-specific business logic | cubquests' `app/api/partner-*/` routes | Per-partner contracts not substrate concern |
| Privy auth wiring | `freeside-auth` sibling repo | Identity overlay is a separate freeside-* module |
| S3 / blob storage | `freeside-storage` sibling repo | Storage substrate is a separate module |
| Indexer infra (Envio · Subsquid) | `freeside-sonar` sibling repo | Onchain indexer substrate is a separate module |
| User scoring + leaderboards | `freeside-score` sibling repo | Scoring substrate is a separate module |
| Discord persona delivery | `freeside-characters` sibling repo | Persona substrate is a separate module |
| World manifests + COSMOGRAPHER authoring | `freeside-worlds` sibling repo | World-manifest registry is a separate module |
| NFT mint factory | `freeside-mint` companion repo (same cycle) | Symmetric companion — see freeside-mint's EXTRACTION-MAP |

## Migration coordination (cycle-Q resume work)

Concrete migration of cubquests-interface to consume `@0xhoneyjar/quests-protocol` + adapters is **NOT** this cycle's scope. The acvp-modules-genesis cycle ships the SHAPE; cycle-Q resume handles the cutover:

1. cubquests-interface declares `compose_with: @0xhoneyjar/quests-protocol` in its world-manifest
2. cubquests-team supplies a postgres `EventStoreContract` adapter (passes the canonical conformance suite at `packages/adapters/src/conformance/event-store-conformance.ts`)
3. cubquests-team supplies their `IdentityResolverPort` (probably Privy-backed)
4. The dual-write window — cubquests writes to BOTH its legacy tables AND the new event-store · validates parity · cuts over · removes legacy

The conformance suite is the safety net. If the postgres adapter passes the gate, the substrate guarantees the migration preserves invariants.

## Reference

- Sprint-1 close (sprint-1/COMPLETED) — protocol + ports + canonical preimage shipped
- Sprint-2 close (sprint-2/COMPLETED) — adapters + MCP + engine shipped
- Sprint-3 (this sprint) — docs + cross-runtime conformance + publish-readiness
- Cycle-Q (paused) — discord-renderer + UI re-alignment · post-sprint-3 resume
- Kickoff: `~/bonfire/grimoires/bonfire/specs/acvp-modules-genesis-kickoff-2026-05-15.md`
- Reality snapshot (sprint-1 T1.0 deferred — see sprint-1 reviewer.md for status)
