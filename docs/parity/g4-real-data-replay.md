# G-4 Contract-Parity — real-data empirical replay (OPERATOR-GATED)

The synthetic G-4 suite (`packages/engine/src/activities/__tests__/writepath-parity.integration.test.ts`)
machine-proves the conservation invariants against a disposable real-Postgres harness.
This doc is the **operator-gated** empirical confirmation against *real* cubquest-db
completion history. It is NOT run automatically — reading 90k users' completion history
for a test is a data-governance decision.

## What the synthetic suite already proves (6/6)
1. **Conservation** — Σ(engine deltas) == Σ(expected); per-account balances reconcile.
2. **Idempotency** — same completion replayed N× → exactly one grant + one ledger row.
3. **No double-grant under concurrency** — K parallel replays → one winner.
4. **Per-tier accuracy** — each Resource amount lands on its tier (common/rare/legendary), alias-aware.
5. **Divergent-key safety** — distinct event_ids sharing a coarse legacy key never silently drop a reward (Phase-1 #4).
6. **Deferred variants don't grant** — BadgeMint/None → 0 ledger mutations; RewardPending recorded.
   Plus a GOLDEN reconciliation (fixed corpus → exact frozen per-tier balances).

## ⚠ FINDING the parity surfaced (load-bearing for the write route)
**Completion event-store partitions MUST be identity-scoped, not activity-scoped.**
With an activity-scoped partition (`scope:"activity", value:activity_id`), two different
users completing the same `(activity, period, step)` collide on CAS: user B's append
(`expected_tip_hash:null`) fails with `CASFailed{expected 0, actual 1}` because user A
already filled the partition — cross-user head-of-line blocking. The correct partition is
`composite` `<identity>::<activity-period-step>` (each completion is the first+only event
in its own partition; re-completion idempotency still fires via event_id duplicate-reject).
The synthetic suite's `partitionOf` now reflects this. **The production write route (gated
behind GATE-SEC-1) MUST build completion partitions the same way** — tracked as a fast-follow
to have `complete()` derive/enforce the identity scope so a caller cannot regress it.

## Operator-gated real-data replay methodology (NOT run here)
1. **Source**: a **read-replica or snapshot** of cubquest-db (never the live primary), or an
   exported, access-controlled extract. Never connect the replay to the production primary.
2. **Window**: a bounded completion window (e.g. one week of `complete_activity_step_tx` /
   `resource_transactions` history) — not the full table.
3. **PII**: hash/redact wallets + identifiers in ALL logs, traces, and intermediate output.
   The reconciliation works on per-tier sums + grant counts, which need no raw PII.
4. **Replay**: for each legacy completion in the window, reconstruct the `ActivityReward`
   (tier + amount from the legacy ledger), the recipient, and the activity/period/step, then
   run it through `makeActivityCompletion().complete()` into a **disposable engine DB** (NOT
   cubquest-db). Use identity-scoped partitions (per the finding above).
5. **Reconcile**: assert Σ(engine-applied per-tier deltas) == Σ(legacy `resource_transactions`
   per-tier deltas) for the window; grant count == distinct legacy completion count;
   idempotency-key dedup matches. Any deviation BLOCKS the write-flip.
6. **Authorization**: requires explicit operator sign-off on the data extract + the conflict
   policy before running. Compose with GATE-SEC-1 (OQ-4 verification-integrity) — both must
   clear before any reward-granting write is enabled in production.
