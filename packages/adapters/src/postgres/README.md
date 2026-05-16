# packages/adapters/src/postgres/ — STUB (sprint-2 review C3)

This directory is intentionally empty of implementation. It exists to host
the future postgres-backed adapter (cubquests-as-module migration cycle).

## What lives here

When the postgres adapter ships:

- `event-store.ts` — `makePostgresEventStore(pool)` returning
  `{ contract: EventStoreContract; port: CompletionEventPort }`
- `reward.ts` — `makePostgresRewardPort(pool)` returning `{ port: RewardPort }`
- `progress.ts` — `makePostgresProgressPort(pool)`
- `identity-resolver.ts` — `makePostgresIdentityResolver(pool)`

## What lives here NOW

The conformance test stubs at `__tests__/*` import the shared conformance
suites from `packages/adapters/src/conformance/` and are marked `.skip` —
they activate when the adapter implementation lands. This is the
"postgres-adapter-conformance test stub" called for in T2.4b (sprint plan
§12.3 Fix-S5) + IMP-003 (NEW S3.T3.10b).

## How to land the postgres adapter

1. Implement `makePostgres*` factories under this directory.
2. Replace `.skip` with `.run` (or remove the `describe.skip` wrappers) in
   the conformance runners.
3. Run the same tests — they should pass without modification. If a
   scenario fails, the bug is in the adapter (NOT the suite).
4. Document any adapter-specific deviations in this README — DO NOT fork
   the conformance suite.

See `grimoires/loa/a2a/sprint-2/engineer-feedback.md` C3 for context.
