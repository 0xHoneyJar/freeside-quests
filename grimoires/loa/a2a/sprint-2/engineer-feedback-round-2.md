# Sprint-2 Senior Lead Review — Round 2: APPROVED

**Cycle**: acvp-modules-genesis
**Sprint**: 2 (adapters + MCP + engine)
**Reviewer**: Senior Tech Lead (Claude Opus 4.7 · adversarial review iteration 2 · 2026-05-16)
**Verdict**: **All good**
**Workspace tests**: 648 (646 passed + 2 skipped postgres stubs · was 612 in round 1)
**Sprint exit criteria**: 7/7 met ✓

---

## Round 2 Verification

All 9 round-1 blockers verified addressed:

| Blocker | Verification |
|---|---|
| **C1** jti LRU memory cap + AuthReplayStore port | `bearer-token.ts:165-204` LRU eviction + cold-start posture · `packages/protocol/src/auth-ports/AuthReplayStore.ts` published · 4 new tests in `bearer-token.test.ts` (`Fix-S6: bounded LRU` + `cold-start posture` blocks) |
| **C2** KeyProviderPort + rotation tests (IMP-005) | `packages/protocol/src/auth-ports/KeyProviderPort.ts` + `makeKeyProviderSignatureVerifier` at `bearer-token.ts:128-167` + `makeInMemoryKeyProvider` fixture + 8 IMP-005 rotation tests in `key-rotation.test.ts` (active · grace · expired · revoked · unknown · provider-unavailable · listActiveKids · key-material-passthrough) |
| **C3** Factory-shaped conformance suites | `packages/adapters/src/conformance/{event-store-conformance,reward-port-conformance}.ts` published · in-memory runner files at `packages/adapters/src/in-memory/__tests__/{event-store-conformance-runner,reward-conformance-runner}.test.ts` · postgres stub directory `packages/adapters/src/postgres/` with `.skip` placeholders activating when adapter lands |
| **C4** CASFailed payload reconstruction | `completion-event.ts:38` adds `tipSequenceByEventId` map · `completion-event.ts:163-181` reconstructs expected_version from prior tip · 2 new tests in conformance suite |
| **C5** Cursor signer uses canonicalizeJCS | `cursor.ts:24` imports + `cursor.ts:74-81` uses `canonicalizeJCS` · key-order test added at `cursor.test.ts:96-122` |
| **C6** Cursor signer real HMAC + no "HMAC" lie | `cursor.ts:62-72` uses Web Crypto `crypto.subtle.sign` with `HMAC + SHA-256` · docstring at `cursor.ts:44-58` explicit about NOT being Ed25519 |
| **C7** read negative input rejection | `completion-event.ts:202-211` rejects negative + non-integer with SchemaValidation · 2 new tests |
| **C8** NOTES.md updated with S2 close | `grimoires/loa/NOTES.md` Session Continuity table has sprint-2 close entry covering all 3 implementation cycles + this round-2 fix cycle |
| **C9** reviewer.md T2.7 corrected per IMP-006 | `grimoires/loa/a2a/sprint-2/reviewer.md` line marked ✓ Met with IMP-006 citation · Known Limitations section also updated |

---

## Test count delta

| Metric | Round 1 | Round 2 | Delta |
|---|---|---|---|
| Test files | 35 | 40 | +5 |
| Passing tests | 612 | 646 | +34 |
| Skipped tests | 0 | 2 | +2 (postgres stubs · intentional) |
| Total | 612 | 648 | +36 |

---

## Adversarial concerns (round 1) — disposition

The 5 round-1 adversarial concerns:

1. **Sprint plan amendments dropped silently** — RESOLVED. All 5 amendments (Fix-S4 + Fix-S5 + Fix-S6 + Fix-S7 + IMP-005) shipped this round.
2. **Conformance suites not actually portable** — RESOLVED. Factory pattern lets postgres adapter drop in.
3. **Cursor signer's shape-only crypto** — RESOLVED. Real HMAC + explicit Ed25519-disclaimer docstring.
4. **`isMutatingEvent` substring matching** — NOT addressed this round (N1 follow-up). Filing as sprint-3 polish or leave for the next sprint's amendments — not blocking sprint-2 close. Documented as known carryover.
5. **`grants` Map collision via separator** — NOT addressed (N2 follow-up). Same disposition.

N-items 3-6 from round 1 are non-critical and left for sprint-3 polish.

---

## Round 2 Adversarial Analysis

### New concerns surfaced during verification

1. **`makeInMemoryKeyProvider.failClosedOnNonActive` defaults to `true`** which means revoked keys return errors and never reach the validator's signature step. This is the safe default but worth noting: tests that need to assert the validator's own handling of a revoked KeyState (vs the provider's rejection) would need `failClosedOnNonActive: false` + manual handling. Documented at `in-memory-key-provider.ts:32-37`.

2. **`AuthReplayStore` interface published but not yet wired to the validator pipeline.** The protocol-level port exists; the validator continues to use the in-process `JTIReplayTracker` (now properly bounded). Production worlds will plug AuthReplayStore in via a Layer override — that wiring is a sprint-3 task (or whenever Redis ships).

3. **Conformance runners duplicate the original test file's coverage** for event-store. The original `event-store-conformance.test.ts` (18 tests) and the new runner (`event-store-conformance-runner.test.ts` · 13 tests) overlap. Acceptable for now — the original file has more granular assertions (e.g., the specific 10-run determinism block, the after_sequence skip-N variation); the runner is the portable subset that postgres will run. Either keep both (defense in depth · ~30s test runtime · acceptable) OR consolidate in sprint-3.

### Assumption upheld

The round-1 assumption ("in-memory adapters never need concurrency simulation") remains — round 2 did not add a concurrent-grant race test. This is a follow-up for sprint-3 or whenever the postgres adapter lands (where concurrency actually matters).

### Alternative considered

Round 2 adopted the factory-conformance pattern. The alternative ("each adapter ships its own tests") was rejected because it would have made cycle-Q's postgres migration N× the work.

---

## Sprint-2 verification criteria (all met)

- [x] all 15 tasks T2.1 through T2.15 complete with green tests (648 tests)
- [x] adapter conformance suite green (event-store · reward-idempotency · identity-resolver · progress)
- [x] MCP manifest valid · 5 tool specs verified · gateway registration contract documented
- [x] D21+D22+D23+D24+D25 covered (auth + cursor + rate-limit + reward-idem + raffle-threshold)
- [x] golden replay test deterministic across 10 runs
- [x] grimoires/loa/NOTES.md updated with S2 close
- [x] sprint-2 review iteration complete — Fix-S4/S5/S6/S7 + IMP-005 addressed

Sprint exit criteria 7/7. Sprint-2 cleared for `/audit-sprint sprint-2`.

---

## Approval language

**All good (with noted concerns)**

Concerns documented but non-blocking:
- N1: `isMutatingEvent` substring matching — sprint-3 polish
- N2: separator-collision impossibility docstring — sprint-3 polish
- N3: `validateBearerToken` jti record-ordering — defensible posture, no fix needed
- N4: world_foo test fixture prefix — note added, no fix needed
- N5: empty-partition typed array — micro-polish
- N6: cursor base64url Node coupling — sprint-3 (post browser-adapter)
- AuthReplayStore wiring to validator — sprint-3 / Redis ship
- Conformance runner duplication — sprint-3 consolidation candidate

Sprint-1 audit MED-001 (EventEnvelope strict-preimage) remains carryover — flag at sprint-2 audit.

---

**Next gate**: `/audit-sprint sprint-2` — security audit on auth + cursor + raffle threshold surfaces.
