---
type: vault-doctrine-candidate
authored_in: freeside-activities/grimoires/loa/proposals (sprint-3 T3.8)
date: 2026-05-16
status: candidate (pending operator promotion to ~/vault/wiki/concepts/)
target_path: ~/vault/wiki/concepts/weighted-raffle-draw-pattern.md
use_label: background_only (until operator promotes)
related_doctrine:
  - "[[activity-as-protocol]]"  (this pattern instantiates the RaffleEntry kind)
  - "[[agentic-cryptographically-verifiable-protocol]]"  (parent · seed publication = hash commitment)
  - "[[merkle-snapshot-claim-pattern]]"  (sibling pattern · same off-chain-commit-on-chain-verify shape)
sources_of_record:
  - cubquests-interface/lib/resource-raffles/scheduler.ts (production scheduler)
  - cubquests-interface/lib/resource-raffles/provision.ts (resource provisioning)
  - cubquests-interface/lib/resource-raffles/utils.ts (cumulative-walk algorithm)
  - cubquests-interface/lib/resource-raffles/raffle-tags.ts (raffle classification)
  - cubquests-interface/docs/RAFFLES.md §4 (the canonical algorithm doc)
  - freeside-activities/packages/protocol/src/events/RaffleDrawn.ts (substrate event)
  - freeside-activities/packages/mcp-tools/src/raffle-threshold.ts (substrate tier gate)
  - freeside-activities/grimoires/loa/prd.md §FR-7 (RaffleEntry discriminant + cycle binding)
  - freeside-activities/grimoires/loa/sdd.md §6.7 (raffle PRNG hardening · D20)
---

# Weighted Raffle Draw Pattern

> *Ticket-as-weight lottery primitive · PRNG vs VRF · idempotency · seed publication
> invariants · the lottery shape across the substrate.*

## The pattern in one sentence

Users earn tickets via Activity completion; at draw time, a deterministic weighted-cumulative-walk over (user, ticket-count) pairs selects N winners, with the seed published before the draw to guarantee verifiability.

## The 3 tiers

The substrate enforces a tier gate (`packages/mcp-tools/src/raffle-threshold.ts`). The threshold:

> `reward_count > 10 OR reward_class ∈ {NFT, token}` triggers REJECTION unless the cycle config declares `opt_in_tier_1_above_threshold: true` (operator override with documented rationale).

| Tier | RNG source | Acceptable for | Threshold |
|---|---|---|---|
| **TIER-1** | PRNG-only (substrate-side cryptographic random) | Low-stakes raffles (≤10 prizes · cosmetic / external rewards) | REJECTED above threshold unless opt-in |
| **TIER-2** | Block-hash anchored (post-draw block hash from the chain you're indexing) | Medium-stakes raffles | None |
| **TIER-3** | Chainlink VRF (or equivalent verifiable randomness) | High-stakes raffles (large NFT drops · significant token grants · season finale prizes) | None |

The tiers exist because raffles are **adversarial** — the design must assume a motivated attacker who controls their own RNG and will try to claim disproportionate winnings.

## The 4-step process (any tier)

```
1. ACCRUE      users earn tickets via Activity completion
                (badge-claim · mission · partner-bounty)
                → cubquests example: `raffle-tags.ts` decorates user-activity-progress rows
                  with raffle-eligibility metadata

2. SCHEDULE    raffle moves to `scheduled` state with a draw_at timestamp
                → cubquests: `scheduler.ts` 3-state machine (scheduled → open → completed)

3. SEED PUBLISH   commit the seed BEFORE the draw_at timestamp
                → TIER-1: substrate-side cryptographic random (committed via hash · seed revealed at draw_at)
                → TIER-2: anchored to the block hash at draw_at (visible only AFTER draw_at + N confirmations)
                → TIER-3: VRF request fired AT draw_at · oracle response is the seed

4. DRAW         deterministic weighted-cumulative-walk:
                 → enumerate eligible (user, ticket_count) pairs in canonical order
                   (typically lex sort by user_id)
                 → compute cumulative-weight prefix sum
                 → for each winner slot k in 0..N:
                     pick value = ((seed XOR k) mod total_weight)
                     winner[k] = first user whose cumulative-weight ≥ pick
                 → emit RaffleDrawn event with seed + winners + verification surface
```

## ACVP-7-mapping

| ACVP component | Weighted-raffle-draw manifestation |
|---|---|
| **Reality** | The N-prize-K-eligible-users lottery domain |
| **Contracts** | The cumulative-walk algorithm IS a contract (input pairs + seed → output winners is deterministic) |
| **Schemas** | `RaffleDrawn` event schema + ticket-accrual schema + seed-commitment schema |
| **State machines** | `scheduled → open → completed` (3-state · backwards-illegal · committed-seed binds the transition) |
| **Events** | `RaffleDrawn` emitted at draw_at · carries seed + winners + algorithm version |
| **Hashes** | Seed publication is a hash commitment · winners array is content-addressable from (seed, eligible-pairs, algorithm) |
| **Tests** | Reproducibility test (same seed + same pairs → same winners) + threshold gate test (TIER-1 above threshold → REJECTED) |

## Seed publication invariants

This is the load-bearing part of the pattern. Get this wrong and the raffle's verifiability is destroyed.

### Invariant 1 · Seed commits BEFORE draw

The seed (or its hash, in commit-reveal) MUST be published before the draw is computed. Otherwise the operator can choose a seed AFTER seeing eligible-pairs that favors a desired winner.

- **TIER-1 commit-reveal**: at `scheduled` state, the substrate generates seed → publishes `hash(seed)` → at `draw_at`, reveals `seed`. The published hash MUST match the revealed seed.
- **TIER-2 block-hash**: the seed IS the block hash at `draw_at`. Published when the chain mines past `draw_at` (typically + 12 block confirmations to defeat reorg-attacks).
- **TIER-3 VRF**: the seed is the oracle response. VRF protocol guarantees the operator cannot influence the response.

### Invariant 2 · Eligible pairs frozen BEFORE seed reveal

The (user, ticket_count) eligible-pairs list MUST be frozen before the seed is revealed. Otherwise an attacker who learns the seed can game who's in the list.

- **cubquests pattern**: `raffle_tags.ts` snapshots eligibility at `scheduled → open` transition · the (user, ticket_count) pairs are immutable from `open` state onward.

### Invariant 3 · Algorithm version pinned

The algorithm version (`weighted-cumulative-walk-v1`) MUST be pinned in the `RaffleDrawn` event. Changing the algorithm later changes the winners — different algorithm versions produce different outputs from the same (seed, pairs) input.

### Invariant 4 · Idempotent re-derivation

Given the published `RaffleDrawn` event (seed + algorithm version + eligible-pairs URI/hash), any third party MUST be able to re-derive the winners array and verify it matches. The substrate's golden vectors include raffle-draw fixtures for cross-runtime parity.

## Cubquests' production algorithm (TIER-1 reference)

Per `cubquests-interface/docs/RAFFLES.md §4`:

```typescript
// Pseudocode of the production weighted-cumulative-walk
async function drawWinners(
  raffle: Raffle,
  prizeCount: number,
): Promise<Winner[]> {
  // 1. Snapshot eligible (user, ticket_count) pairs in canonical order
  const pairs = await getEligiblePairs(raffle.id); // sorted by user_id ASC
  const totalWeight = sum(pairs.map((p) => p.ticket_count));

  // 2. Build cumulative-weight prefix array
  const cumulative = [];
  let running = 0;
  for (const p of pairs) {
    running += p.ticket_count;
    cumulative.push({ user: p.user, prefix: running });
  }

  // 3. For each prize slot, walk the cumulative array
  const winners: Winner[] = [];
  for (let k = 0; k < prizeCount; k++) {
    const seedXk = (raffle.seed ^ BigInt(k)) % BigInt(totalWeight);
    const winner = cumulative.find((c) => BigInt(c.prefix) >= seedXk);
    winners.push({ slot: k, user: winner.user });
  }

  return winners;
}
```

The PRNG seed is generated by Postgres `gen_random_bytes(32)` (cryptographic-grade via `pgcrypto`). The commit-reveal flow: at `scheduled → open`, store `seed_hash` in the raffle row; at `open → completed`, store the revealed `seed` and verify `sha256(seed) === seed_hash`.

The cubquests algorithm is **idempotent at the Postgres RPC layer** — the draw is wrapped in a `BEGIN; SELECT FOR UPDATE; UPDATE; COMMIT;` transaction so concurrent draw calls produce the same winners or one fails with row-lock contention.

## TIER-2 / TIER-3 escalation guidance

When the substrate gate (`classifyRaffleTier`) rejects TIER-1 above threshold, escalate per:

### TIER-2 implementation outline

Replace the PRNG seed with the block hash at `draw_at + 12 confirmations`. The seed becomes:

```typescript
const seed = await chain.getBlockHash(draw_at_block_number + 12);
```

The draw_at transitions from "now" to "post-confirmation". The verifier (third-party auditor) can re-derive winners by:
1. Fetching the published `RaffleDrawn` event
2. Confirming `seed === blockHash(draw_at_block_number + 12)` against the chain
3. Re-running the cumulative-walk against the same eligible-pairs URI

### TIER-3 implementation outline

Replace the seed source with a Chainlink VRF request fired AT `draw_at`. The VRF protocol guarantees:
- The operator cannot influence the response
- The response is publicly verifiable against the on-chain VRF coordinator state
- The seed is bound to the request (the request hash + the VRF output are the cryptographic commitment)

Implementation: world's draw script makes a VRF request at `draw_at`, waits for the VRF callback, uses the callback's randomness as the seed. The `RaffleDrawn` event carries the VRF request id + response · downstream verification reads from the chain's VRF coordinator.

## Anti-patterns

### ❌ Don't draw with a non-committed seed

Some implementations skip the commit-reveal flow and just generate a seed at `draw_at`. That gives the operator the ability to keep regenerating seeds until they get a winner they like.

### ❌ Don't allow eligible-pairs mutation after `open` state

If the operator can add/remove eligible users after `scheduled → open`, the raffle's integrity is destroyed. The `open` state is a freeze gate.

### ❌ Don't use `Math.random()` or `Date.now()` as seed

Browser `Math.random()` is not cryptographic. `Date.now()` is operator-influenceable. Use `crypto.getRandomValues` for TIER-1 PRNG, block-hash for TIER-2, VRF for TIER-3.

### ❌ Don't allow seed re-derivation

Don't expose an endpoint or function that re-derives the seed from external state — if the algorithm depends on `draw_at_unix_ms`, anyone who knows `draw_at_unix_ms` knows the seed. The seed must be cryptographic-random or oracle-anchored.

## Substrate hook points

`freeside-activities` provides:

1. **`RaffleDrawn` event schema** (`packages/protocol/src/events/RaffleDrawn.ts`) — the canonical shape emitted at draw time. Carries seed + winners + algorithm_version + verification_uri.

2. **`classifyRaffleTier` gate** (`packages/mcp-tools/src/raffle-threshold.ts`) — the substrate-enforced tier classifier. World cycle configs are validated through this function at load time.

3. **VerificationMethod.PartnerApi + WebhookHmac variants** — the canonical verification shapes raffle-entry Activity kinds use to verify ticket-accrual from off-chain partner systems.

4. **Future: raffle-entry Activity kind** — when sprint-3 promotes `raffle-entry` from the discriminant list into a first-class Activity kind, worlds can model the entire ticket-accrual + scheduling + draw + winner-notification lifecycle as an Activity.

## D20 resolution (from SDD §6.7)

Per the sprint plan §12 D20 resolution: **TIER-1 is acceptable ONLY for low-stakes raffles**. Above-threshold raffles MUST escalate to TIER-2 or TIER-3. The substrate enforces this at load-time so misconfiguration fails closed before any ticket accrues.

Worlds that genuinely need TIER-1 above threshold (e.g., long-running cosmetic raffles with ≥10 prizes where the operator absorbs the residual integrity risk) MUST set `opt_in_tier_1_above_threshold: true` explicitly. The flag IS the operator's signed acknowledgment.

## References

- Production reference: `cubquests-interface/lib/resource-raffles/` (years of TIER-1 production)
- Canonical algorithm doc: `cubquests-interface/docs/RAFFLES.md §4`
- Substrate event: `freeside-activities/packages/protocol/src/events/RaffleDrawn.ts`
- Substrate gate: `freeside-activities/packages/mcp-tools/src/raffle-threshold.ts`
- Substrate verification surfaces: `freeside-activities/packages/protocol/src/activity/ActivityStep.ts` (VerificationPartnerApi + VerificationWebhookHmac)
- PRD anchor: `freeside-activities/grimoires/loa/prd.md` §FR-7 RaffleEntry discriminant + cycle binding
- SDD anchor: `freeside-activities/grimoires/loa/sdd.md` §6.7 raffle PRNG hardening (D20 RESOLVED · tiered)
- Parent doctrine: `[[activity-as-protocol]]`
- Sibling pattern: `[[merkle-snapshot-claim-pattern]]` (same off-chain-commit-on-chain-verify shape · different domain)
- Parent doctrine: `[[agentic-cryptographically-verifiable-protocol]]`
- Cross-chain reference: Chainlink VRF v2 documentation (TIER-3 reference impl)
