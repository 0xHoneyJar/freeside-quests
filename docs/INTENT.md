# INTENT — what `freeside-activities` IS

> Renamed from `freeside-quests` 2026-05-15 as part of the **acvp-modules-genesis** cycle.
> This file is the canonical post-rename framing. See `acvp-modules-genesis-kickoff-2026-05-15.md`
> (in `~/bonfire/grimoires/bonfire/specs/`) for the lineage and `grimoires/loa/{prd,sdd,sprint}.md`
> for the current spec surface.

---

## WHAT IT IS

The unified **Activity** supertype for identity-bound participation records.

An `Activity` has:
- a **kind** discriminant (`quest` · `mission` · `badge-claim` · `raffle-entry` · world-defined extensions)
- a **period_key** time-axis (null for one-shot · ISO-week for recurring · custom for season-bound)
- a **steps[]** sequence of `ActivityStep` (each step carries a sealed `VerificationMethod` union)
- a **reward** shape (sealed union: badge · token · resource · cosmetic · external · none)
- a **completion-event schema** ($id-pinned · canonical-preimage hashed · hash-chained)

The substrate ships:

- **Sealed schemas** — Effect.Schema + JSON Schema · cross-runtime determinism via RFC 8785 JCS + SHA-256
- **Typed ports** — `ProgressPort` · `CompletionEventPort` · `RewardPort` · `IdentityResolverPort` (Effect-returning · sealed error unions · never throw)
- **EventStoreContract** — append-only · CAS · monotonic-sequence per partition · duplicate-reject (FR-11)
- **In-memory adapters** — TEST/DEV fixtures · ship with the module · canonical conformance suite
- **MCP agent surface** — 5 read-only tools (`get-active-activities` · `get-progress` · `get-badges` · `get-raffle-entries` · `list-kinds`) · Ed25519-signed bearer tokens · TIER-1 raffle threshold gate
- **Engine composition** — Effect Layer wiring · activity lifecycle state machine · reward retry orchestrator · golden-replay determinism gate

ACVP-shaped: agents reason, substrate verifies. Hashes prove. Events trace. Tests bind.

## WHAT IT IS NOT

- **Not a Discord bot.** Not a Next.js app. Not a Postgres schema. Not a Subsquid indexer.
- **Not a partner-integration directory.** Not a payment surface. Not an auth provider (that's `freeside-auth`).
- **Not opinionated about REWARD shape.** Badge? Token? Off-chain? Cosmetic? — *world decides*.
- **Not opinionated about VERIFICATION.** On-chain witness? Signed memo? Manual curator? Webhook HMAC? — *world decides*.
- **Not opinionated about ASSET ownership.** "Meaning in ownership" varies per world.
- **Not a runtime.** Not a deployment target. Not a chain.
- **Not the source of truth for QUEST CONTENT.** That stays at `cubquests.com` (the canonical operator surface). This module owns the SHAPE, not the IMPL.

## LINEAGE

Informed by **CubQuests** (`cubquests.com` · years of production · ~10K+ users · production-validated data shape). The Activities-Unification design discovery — documented in `cubquests-interface/AGENTS.md §1` — crystallizes here:

> *"Quests and Missions are the SAME thing — both are Activities."*
> `period_key` as time-axis discriminant.
> ONE table · ONE API · ONE pipeline.

Folded forward: **`BadgeClaim`** and **`RaffleEntry`** are also Activity kinds (with their own step shapes + verification surfaces). The cubquests team didn't reach this leap because badges + raffles ship outside the unified-activity pipeline today. The rename to `freeside-activities` earns its keep by making the leap explicit.

**Compass-cycle-1 (2026-05-12 → 2026-05-13)** is the reference implementation for the typed-port + golden-vector + adapter-conformance discipline this module inherits. Compass-cycle-1's CardCommitted double-emit lesson (P18 in `construct-fagan`) shapes our event-store CAS + duplicate-reject invariants.

**Heritage preserved**: the `cubquests-interface` product remains the canonical operator surface. Its years of design wisdom — resource economy · season cadences · partner integrations · cosmetics — STAY in cubquests. This module owns the SHAPE, not the IMPL.

**Symmetric sibling**: `freeside-mint` ships in the same cycle as the NFT-mint factory protocol. Worlds compose `freeside-activities` + `freeside-mint` + their own `TreasuryPort` to instantiate composition patterns like the `[[closed-loop-reward-mechanic]]` (questponzi-as-substrate · cubquests-flavored · purupuru can call it `eldercouncil` · mibera can call it `tithe-rotation`).

## CONSTRAINTS

The substrate enforces these at the schema + interface boundaries:

1. **Schemas live here · content stays in each world's database** (per [[contracts-as-bridges]])
2. **Schema governance imported from loa-constructs** — enum-locked `schema_version` · additive-only minors · breaking changes require new `$id` (see `VERSIONING.md`)
3. **ActivityKind sealed union** — `quest`·`mission`·`badge-claim`·`raffle-entry` is INITIAL · earns new kinds via `/architect` OR per-world via `WorldDefined` seam (substrate enforces 16 KiB + 8-level-nesting bounds on world payloads)
4. **Event-completeness invariant (CL-Event-1)** — no Activity may transition state without an emitted `CompletionEvent`
5. **Hash-chain continuity (CL-Event-2)** — every reward emission carries `source_event_hash` linking back to a completion-event
6. **Hash determinism (CL-Event-3)** — `event_id = SHA-256(canonical-preimage via RFC 8785 JCS)` · golden vectors guarantee cross-runtime identity (Node · Bun · Rust · Python)
7. **Fix-A1 nonce policy** — mutating events MUST carry caller-supplied nonce; substrate refuses derived-nonce fallback (computeEventId rejects + adapter rejects at append time · defense in depth)
8. **Identity is opaque at the substrate boundary** (A5) — `IdentityResolverPort` is the ONE place chain addresses may be looked up
9. **MCP tools are READ-ONLY** (A7) — agent surface is query-plane only; mutations go through engine + ports
10. **CMP-convention** (A8 + FR-10) — substrate has NO user-visible strings; surface adapters translate substrate names to chat-medium names (see `CMP-CONVENTION.md`)
11. **Worlds MUST NOT alter schema fields they didn't add** — additive composition only · `WorldDefinedPayload` slot is the seam

## How worlds use it

```yaml
# world-manifest.yaml (in any freeside world)
compose_with:
  - "@0xhoneyjar/quests-protocol"                    # sealed schemas
  - "@0xhoneyjar/freeside-activities-adapters"       # in-memory dev adapters (or world-built postgres / convex)
  - "@0xhoneyjar/quests-engine"                      # Effect Layer composition + state machines
  - "@0xhoneyjar/freeside-activities-mcp-tools"      # MCP agent surface
```

The world supplies:
- A real `IdentityResolverPort` (in-memory is TEST-FIXTURE-ONLY per A5)
- A `KeyProviderPort` (JWKS / Vault / KMS) for MCP bearer-token verification
- An `AuthReplayStore` (Redis SETEX) for jti replay protection at production scale
- A production adapter for `EventStoreContract` (postgres · convex · etc) that passes the canonical conformance suite

Adapter conformance suites at `packages/adapters/src/conformance/` are **portable** — same `describe`/`it` blocks run against postgres + convex + in-memory by supplying a factory.

## Cycle status (2026-05-16)

- **Sprint-1** complete + audited APPROVED (20/20 tasks · 475 tests · 1 MED deferred)
- **Sprint-2** complete + audited APPROVED (15/15 tasks · 137 new tests · 3 LOW deferred · LOW risk)
- **Sprint-3** in progress (docs + cross-runtime conformance + publish-readiness · this file is T3.1)

Workspace test totals: **648 passed + 2 skipped postgres stubs**.

## Reference

- Parent doctrine: `[[agentic-cryptographically-verifiable-protocol]]` (ACVP) — this module is one APPLICATION-layer instance
- Sibling: `[[freeside-modules-as-installables]]` — the family this module belongs to
- Companion: `freeside-mint` (NFT-mint factory protocol · same cycle)
- Composition pattern: `[[closed-loop-reward-mechanic]]` (questponzi-as-substrate · vault doctrine candidate)
- Reference impl: `compass-cycle-1` (CardCommitted typed-port + golden-vector + adapter-conformance discipline)
- Operator surface (canonical): `cubquests.com` — quest CONTENT stays here; this module owns SHAPE
- Cycle kickoff: `~/bonfire/grimoires/bonfire/specs/acvp-modules-genesis-kickoff-2026-05-15.md`
- Spec surface: `grimoires/loa/{prd,sdd,sprint}.md`
