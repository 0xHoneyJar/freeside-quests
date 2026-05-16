@.claude/loa/CLAUDE.loa.md

# freeside-activities — agent instructions

> Renamed from `freeside-quests` 2026-05-15 (acvp-modules-genesis cycle).
> This file is forward-pointing only. The legacy scaffold framing has been
> superseded — read `docs/INTENT.md` for the canonical "what is this module".

## What this repo is

The **Activity substrate** for freeside worlds. Sealed wire-format schemas + typed Effect ports + in-memory adapters + MCP agent surface + engine composition. Installable module — worlds compose it via `compose_with` declarations.

ACVP-shaped (`[[agentic-cryptographically-verifiable-protocol]]`): agents reason, substrate verifies, hashes prove, events trace, tests bind.

See:
- **`docs/INTENT.md`** — WHAT IT IS / WHAT IT IS NOT / LINEAGE / CONSTRAINTS
- **`docs/EXTRACTION-MAP.md`** — per-package source-of-record citations
- **`docs/INTEGRATION-PATH.md`** — 4-step world adoption guide
- **`docs/ACVP-MATRIX.md`** — the 7-component canonical reference
- **`docs/CMP-CONVENTION.md`** — substrate-name vs chat-medium-name discipline
- **`docs/VERSIONING.md`** — schema_version + breaking-change SLA
- **`grimoires/loa/{prd,sdd,sprint}.md`** — current spec surface
- **Kickoff**: `~/bonfire/grimoires/bonfire/specs/acvp-modules-genesis-kickoff-2026-05-15.md`

## When this CLAUDE.md applies

Load when an agent is:
- Implementing a sprint task in `freeside-activities` (sprint-1/2/3 docs in `grimoires/loa/`)
- Authoring a new world that wants to consume the activities substrate (`compose_with`)
- Extending the protocol with a new ActivityKind / VerificationMethod / reward variant
- Wiring an MCP gateway against this module's agent surface
- Migrating cubquests-interface to consume the module (cycle-Q resume work)

## Hard rules

### Substrate boundary discipline

- **Schemas live here · content stays at cubquests.com.** Quest DEFINITIONS (shape · completion criteria · badge schemas) are this module's job. Quest CONTENT (the actual quests authored on cubquests.com) stays in CubQuests' Postgres DB. Per `[[contracts-as-bridges]]`.

- **A8 — substrate has NO user-visible strings.** Surface adapters translate substrate identifiers to medium-appropriate copy. See `docs/CMP-CONVENTION.md`. If you find yourself adding a `title` or `description` field to a substrate schema, STOP — that's presentation, not substrate.

- **A5 — identity is opaque at the substrate boundary.** `IdentityResolverPort` is the ONE place chain addresses may be looked up. Never reach across the boundary directly.

- **A6 — `event_id` is canonical hash · NO bare hash() calls in adapters.** Use `computeEventId` from `packages/protocol/src/events/compute-event-id.ts`. The in-memory adapter re-derives + rejects mismatches by default (`verifyEventId: true`); production adapters SHOULD too (defense in depth).

- **A7 — MCP tools are READ-ONLY.** Agent surface is query-plane only. Mutations go through engine + ports, not through MCP.

### Schema governance

- **Effect.Schema + JSON Schema dual presentation.** Effect.Schema is the runtime · JSON Schema is the cross-runtime contract.
- **Enum-locked `schema_version`** · additive-only minors · breaking changes require new `$id` (see `docs/VERSIONING.md`).
- **Sealed unions are the boundary** (A1) · no escape hatches outside `WorldDefined`. `ActivityKind` is `quest | mission | badge-claim | raffle-entry | WorldDefined(<world>:<kind>)`. Adding a 5th built-in kind requires `/architect` cycle.
- **JCS canonicalization is mandatory** (RFC 8785) for all hashable content. One third-party call site: `canonicalize` npm pkg via `packages/protocol/src/encoding/jcs.ts`.

### ACVP invariants (load-bearing)

- **CL-Event-1** (event-completeness) — no Activity transitions state without a `CompletionEvent`
- **CL-Event-2** (hash-chain) — every event carries `source_event_hash` linking back
- **CL-Event-3** (hash-determinism) — `event_id = SHA-256(canonical JCS preimage)`
- **CL-Event-5** (nonce-mediated collision) — caller-supplied nonce on mutating events (Fix-A1 · the substrate refuses derived-nonce fallback)
- **CL-EventStore-1..7** — APPEND-ONLY · monotonic-sequence · CAS · duplicate-reject · scope-mismatch · replay-determinism · nonce-collision
- **CL-Port-1** — every port operation returns Effect · NO bare throws
- **CL-Port-2** — every sealed-error variant MUST be reachable in adapter tests
- **D18 idempotency** — RewardPort returns existing grant via `AlreadyGranted` on duplicate `(originating_event_id, recipient)` tuple

### Coordination

- **Don't extract code from cubquests without coordination.** cubquests-interface migration is cycle-Q resume work (NOT this cycle). The acvp-modules-genesis cycle ships the SHAPE; the cutover is separate.
- **Sprint plan amendments are binding.** Sprint-1 sprint plan §12.3 + §12.4 + §12.5 ship as part of the task surface — don't ignore Fix-S1..S8 / IMP-001..006 when implementing.

## Composition graph

| Repo | Role | Relationship to this module |
|---|---|---|
| `0xHoneyJar/freeside-mint` | NFT-mint factory protocol (companion · same cycle) | Worlds compose freeside-activities + freeside-mint + their own TreasuryPort for `[[closed-loop-reward-mechanic]]` |
| `0xHoneyJar/freeside-worlds` | World manifest registry | Worlds declare `compose_with: @0xhoneyjar/quests-protocol` here |
| `0xHoneyJar/freeside-score` | Scoring substrate | Activity completion can emit scoring events (cross-module composition) |
| `0xHoneyJar/freeside-storage` | Storage substrate | Badge images · raffle artwork live in storage adapters |
| `0xHoneyJar/freeside-auth` | Identity substrate | Worlds plug `freeside-auth`-issued tokens through the activities MCP bearer-token validator |
| `0xHoneyJar/freeside-mediums` | Medium capability registry | Surface adapters consult the medium registry for what each chat medium can render |
| `0xHoneyJar/freeside-characters` | Persona substrate | Discord delivery of activity-state surfaces through `freeside-characters` personas |
| `0xHoneyJar/freeside-sonar` | Onchain indexer | Reward grants and BadgeIssued events are indexed for cross-world discovery |
| `cubquests-interface` | Canonical CM surface (operator dashboard) | STAYS as the source-of-truth for QUEST CONTENT · this module owns SHAPE only |
| `compass` + `compass-cycle-1` | Reference implementation | Typed-port + golden-vector + adapter-conformance discipline this module inherits |

## What this repo does NOT own

- **Operator-facing dashboards** — cubquests-interface stays canonical
- **Quest CONTENT** — actual authored quests live in cubquests Postgres
- **Identity providers** — Privy / Dynamic / Sietch are world concerns · this module is opaque about identity (A5)
- **Persona delivery (Discord · Telegram · CLI)** — `freeside-characters` owns persona substrate
- **NFT minting impl** — `freeside-mint` owns the factory protocol
- **Onchain indexing** — `freeside-sonar` owns the indexer substrate
- **Scoring / leaderboards** — `freeside-score` owns the scoring substrate
- **Production adapters (postgres · convex)** — world-built · ship outside this module

## Workflow gates (Loa)

Standard Loa workflow applies. See `.claude/loa/CLAUDE.loa.md` for the full reference.

- `/plan-and-analyze` → `/architect` → `/sprint-plan` → `/run sprint-N` → `/review-sprint` → `/audit-sprint`
- Sprint task tracking via `br` (beads_rust) when available · markdown fallback otherwise
- Memory protocol: maintain `grimoires/loa/NOTES.md` for cross-session context
- ACVP discipline is enforced at schema layer (Effect.Schema) + interface layer (Effect-returning ports) + adapter layer (conformance suites)

## Current state (2026-05-16)

| Sprint | Status |
|---|---|
| **Sprint-1** (protocol + ports + canonical preimage) | ✓ COMPLETED + AUDITED APPROVED |
| **Sprint-2** (adapters + MCP + engine) | ✓ COMPLETED + AUDITED APPROVED (3 LOW deferred) |
| **Sprint-3** (docs + cross-runtime conformance + publish-readiness) | ⏳ in progress |

Workspace tests: **648 passed + 2 skipped postgres stubs** (40 test files).

## Reference doctrine

These doctrine pages live in the operator vault (`~/vault/wiki/concepts/`). They are reference-only — activate through the Doctrine Activation Protocol (see operator's global CLAUDE.md OperatorOS):

- `[[agentic-cryptographically-verifiable-protocol]]` — parent · this module is one APPLICATION-layer instance
- `[[agentic-game-infrastructure]]` — first named ACVP application
- `[[freeside-modules-as-installables]]` — the family this module belongs to
- `[[chat-medium-presentation-boundary]]` — CMP discipline doctrine
- `[[contracts-as-bridges]]` — typed contracts as load-bearing bridges
- `[[schema-is-not-the-contract]]` — schemas describe shape · contracts include behavior + invariants
- `[[mibera-as-npc]]` — two-tier (construct judges · substrate verifies) · low-stakes-creativity unlock
- `[[closed-loop-reward-mechanic]]` — questponzi-as-substrate composition pattern (worlds instantiate)

## Issue tracking

- GitHub issues / PRs · `0xHoneyJar/freeside-activities`
- Beads task graph: `br list` (if beads_rust installed) · falls back to `grimoires/loa/sprint.md` task table
