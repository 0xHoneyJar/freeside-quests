# cubquests-snapshot-2026-05-15

> **Risk-mitigation snapshot per acvp-modules-genesis kickoff (IMP-004 amendment).**
> Captures cubquests-interface key evidence files at the cycle-close moment so
> that if cubquests-interface ever winds down OR the cited files mutate, the
> evidence cited by this module's docs (INTENT · EXTRACTION-MAP) survives.

## Snapshotted files

| File | Source path | Cited by |
|---|---|---|
| `AGENTS.md` | `cubquests-interface/AGENTS.md` | INTENT.md (Activities-Unification §1) · EXTRACTION-MAP.md (multiple rows) · activity-as-protocol vault doctrine |
| `RAFFLES.md` | `cubquests-interface/docs/RAFFLES.md` | EXTRACTION-MAP.md (raffle algorithm §4) · weighted-raffle-draw-pattern vault doctrine |
| `questponzi.mdx` | `cubquests-interface/content/blog/questponzi.mdx` | Kickoff §1.1 (closed-loop-reward-mechanic design DNA) |
| `badge-merkle.ts` | `cubquests-interface/lib/blockchain/badge-merkle.ts` | EXTRACTION-MAP.md (BadgeIssued event row) · merkle-snapshot-claim-pattern vault doctrine |

## Snapshot date

2026-05-16 (sprint-3 close · acvp-modules-genesis cycle)

## How to refresh

If cubquests-interface ships major changes to any of these files AND those
changes affect the freeside-activities substrate's understanding of the source
domain, re-snapshot via:

```bash
SRC=~/Documents/GitHub/cubquests-interface
cp "$SRC/AGENTS.md" grimoires/loa/reality/cubquests-snapshot-{date}/
cp "$SRC/docs/RAFFLES.md" grimoires/loa/reality/cubquests-snapshot-{date}/
cp "$SRC/content/blog/questponzi.mdx" grimoires/loa/reality/cubquests-snapshot-{date}/
cp "$SRC/lib/blockchain/badge-merkle.ts" grimoires/loa/reality/cubquests-snapshot-{date}/
```

Keep both the old and new snapshot directories side-by-side · the cite-trail
in INTENT.md + EXTRACTION-MAP.md can rotate to the newer date or remain pinned
to this one depending on what the docs assert.

## Why this exists

Per kickoff §1.1: cubquests-interface is years-of-production evidence that shaped
this module's design. The Activities-Unification crystallization (AGENTS.md §1)
is the load-bearing insight that the substrate codifies. If that file disappears
or mutates, our INTENT.md citation becomes a 404. The snapshot is the
risk-mitigation: cite a frozen copy here, not a moving target there.

IMP-004 (sprint plan §12.4 HIGH_CONSENSUS) flagged this risk and moved the
snapshot from T3.13 to S1.T1.0 (early-S1). Sprint-1 didn't execute it; sprint-3
review (round 1) caught the miss; this directory is the round-2 fix.
