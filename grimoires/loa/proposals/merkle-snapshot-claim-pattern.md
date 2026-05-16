---
type: vault-doctrine-candidate
authored_in: freeside-activities/grimoires/loa/proposals (sprint-3 T3.7)
date: 2026-05-16
status: candidate (pending operator promotion to ~/vault/wiki/concepts/)
target_path: ~/vault/wiki/concepts/merkle-snapshot-claim-pattern.md
use_label: background_only (until operator promotes)
related_doctrine:
  - "[[activity-as-protocol]]"  (this pattern instantiates the BadgeClaim kind)
  - "[[agentic-cryptographically-verifiable-protocol]]"  (parent)
  - "[[contracts-as-bridges]]"  (the merkle-root commitment IS the contract)
sources_of_record:
  - cubquests-interface/lib/blockchain/badge-merkle.ts (the prod implementation)
  - cubquests-interface/lib/badge-snapshot/generator.ts (off-chain daily snapshot)
  - cubquests-interface/lib/badge-snapshot/set-root-on-chain.ts (on-chain commitment)
  - cubquests-interface/lib/badge-snapshot/__tests__/ (production test coverage)
  - mibera-grails (sister implementation · same shape · different domain)
  - freeside-activities/packages/protocol/src/events/BadgeIssued.ts (canonical event)
  - freeside-activities/grimoires/loa/prd.md §FR-6 (BadgeClaim discriminant + merkle-snapshot binding)
---

# Merkle Snapshot Claim Pattern

> *Off-chain snapshot → IPFS merkle root → on-chain claim · the badge-distribution shape.*

## The pattern in one sentence

A trusted-off-chain process computes a leaf-set, builds a merkle tree, publishes the root on-chain, then individual users claim their leaves with merkle proofs against the published root.

## The 4 steps

```
1. SNAPSHOT       off-chain process determines who earned what
                   (cron · scheduled · daily/weekly cadence)
                   → leaf set: [{recipient, badge_id, earn_ts}, ...]

2. ROOT BUILD     compute merkle tree over the leaf set
                   → merkle_root: bytes32

3. PUBLISH        commit the merkle_root on-chain (transaction)
                   → snapshot_id, merkle_root, ipfs_uri (full proofs)

4. CLAIM          user calls claim() with their leaf + merkle proof
                   → contract verifies proof against published root
                   → mints/transfers the badge to msg.sender
```

The pattern's value:
- **Gas-efficient distribution**: ONE transaction publishes the root for N recipients (vs N transactions to airdrop each leaf)
- **Trustless verification**: anyone can verify a claim's proof against the published root
- **Async finality**: users claim at their own pace · no urgent batch operation
- **Reproducible**: the snapshot algorithm + leaf set + tree-build algorithm together fully determine the root

## ACVP-7-mapping

| ACVP component | Merkle-snapshot-claim manifestation |
|---|---|
| **Reality** | Off-chain participation history (the "who earned what" question) |
| **Contracts** | The merkle-tree build algorithm IS a contract (output bytes = input bytes ↔ root bytes) |
| **Schemas** | `BadgeIssued` event schema + snapshot-leaf schema + claim-call schema |
| **State machines** | snapshot lifecycle: `scheduled → built → published → claimed-partial → claimed-fully` |
| **Events** | `BadgeIssued` event emitted on-chain at claim time · indexed for sonar-style discovery |
| **Hashes** | merkle-root commits to leaf-set · individual claims produce merkle-proof witnesses |
| **Tests** | reproducibility test (same snapshot input → same root) + claim-verification test (valid proof → accept · invalid proof → reject) |

## Production instances of this pattern

| Instance | Source | Domain |
|---|---|---|
| **cubquests badges** | `cubquests-interface/lib/badge-snapshot/` (production · long-running) | Activity-based badge distribution |
| **mibera-grails** | (sister implementation) | NFT-based identity grail distribution |
| **future: freeside-activities BadgeClaim** | `freeside-activities/packages/protocol/src/events/BadgeIssued.ts` (substrate-level event shape) | Cross-world badge claim substrate |

The substrate (this module) doesn't ship the snapshot generator or the on-chain contract — those live in each world's deployment. The substrate ships the EVENT SHAPE that BadgeClaim activities emit (`BadgeIssued` with `recipient`, `merkle_root`, `snapshot_id`, `proof_uri`).

## Architecture sketch

```
World's domain                    Substrate's role
─────────────                     ──────────────────
[Activities Engine]               
   ↓ identifies who-earned-what
[Snapshot Generator (off-chain)]  
   ↓ computes leaves              
[Merkle Builder (off-chain)]      
   ↓ publishes root + ipfs
[On-Chain Contract (BadgeMint)]   
   ↑ user calls claim()           
[Claim verification]              
   → emits Transfer event         
   → World indexes event          
   → World calls into             →   freeside-activities/packages/protocol/src/events/BadgeIssued.ts
     CompletionEventPort.emit         (substrate-level BadgeIssued event)
     with the canonical              The substrate guarantees:
     BadgeIssued event                  - event_id = SHA-256(canonical preimage)
                                        - hash-chain continuity (source_event_hash)
                                        - schema-level shape contract
```

Worlds compose this freely: cubquests can keep its existing badge-merkle.ts implementation; freeside-activities just owns the SHAPE of the event the world emits at claim-time.

## Invariants the pattern enforces

1. **Snapshot determinism** — same input leaf set + same tree-build algorithm → identical root. If a world's snapshot is non-deterministic, the merkle commitment is meaningless.

2. **Root publication finality** — once published on-chain, the root is immutable. Any disputed leaf must be addressed by the NEXT snapshot, not by mutating the published root.

3. **Proof verification on-chain** — the contract MUST verify the merkle proof against the published root before issuing the badge. NO out-of-band trust.

4. **Idempotent claim** — a user can call claim() at most once per leaf. The contract tracks which leaves have been claimed.

5. **Cross-snapshot leaf identity** — if the same user earned the same badge across two snapshots, the leaves MAY produce two different roots (each snapshot has its own root). The world decides whether to allow re-claim (typically NO — see invariant 4 at world-level).

## When this pattern fits

✓ **Use merkle-snapshot-claim when:**
- The leaf set is large (50+ recipients) — gas savings are real
- The cadence is batch (daily / weekly / season-end) — pre-computation amortizes
- The claim is opt-in by recipient — async finality is desirable
- The leaves are computable from off-chain state (activity completion · scoring · partner data)

✗ **Don't use merkle-snapshot-claim when:**
- The leaf set is small (<10) — direct airdrop is simpler and roughly the same gas
- Time-sensitivity matters (immediate reward · time-locked unlock) — async claim isn't acceptable
- The verification logic is non-trivial — merkle-leaf proofs only verify "this leaf was in the published set", not "this leaf is currently valid"
- The recipient set is sensitive (privacy concerns) — anyone can read the IPFS-published leaf set

## Anti-patterns

### ❌ Don't trust off-chain state without commitment

Some implementations publish "the snapshot is at this CID" without committing the root to chain. That gives the operator the ability to re-roll the CID and silently change the leaf set. The root MUST be on-chain.

### ❌ Don't allow root mutation

If the operator can mutate the published merkle root (via owner-only setter without checks), the trustless-verification property is destroyed. The root MUST be append-only — corrections happen via a NEW snapshot with a NEW root, not by overwriting.

### ❌ Don't fork the merkle library per-snapshot

The merkle-tree implementation must be the same across snapshots, otherwise root-determinism breaks. cubquests uses `merkle-tools` (or equivalent) consistently — same library · same options · same hashing algorithm.

## Substrate hook points

`freeside-activities` provides:

1. **`BadgeIssued` event schema** (`packages/protocol/src/events/BadgeIssued.ts`) — the canonical shape emitted at claim time. Worlds use this when wiring their indexer (envio / subsquid / etc.) to translate on-chain `Transfer` events into substrate-level `BadgeIssued` events.

2. **Future: badge-claim Activity kind** — when sprint-3 promotes `badge-claim` from the discriminant list into a first-class Activity kind, worlds can model the entire merkle-snapshot-claim lifecycle as an Activity (not just the claim moment).

3. **VerificationMethod.MerkleProof variant** (already shipped in sprint-1) — the canonical verification shape `freeside-activities` uses to encode "the user's claim verified against on-chain merkle root X".

## References

- Production reference: `cubquests-interface/lib/blockchain/badge-merkle.ts` + `lib/badge-snapshot/`
- Sister instance: mibera-grails (different domain · same pattern)
- Substrate event: `freeside-activities/packages/protocol/src/events/BadgeIssued.ts`
- Substrate verification surface: `freeside-activities/packages/protocol/src/activity/ActivityStep.ts` (VerificationMerkleProof)
- PRD anchor: `freeside-activities/grimoires/loa/prd.md` §FR-6 BadgeClaim discriminant + merkle-snapshot binding
- Parent doctrine: `[[activity-as-protocol]]`
- Parent doctrine: `[[agentic-cryptographically-verifiable-protocol]]`
- Merkle tree library prior art: OpenZeppelin MerkleProof (Solidity) + merkle-tree-solidity (JS) — operator's preferred stack
