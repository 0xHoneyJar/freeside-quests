# Sprint-2 Senior Lead Review — CHANGES REQUIRED

**Cycle**: acvp-modules-genesis
**Sprint**: 2 (adapters + MCP + engine)
**Reviewer**: Senior Tech Lead (Claude Opus 4.7 · adversarial review · 2026-05-16)
**Verdict**: **CHANGES REQUIRED**
**Implementer commits reviewed**: `d6b5e8e` → `e16ef92` → `052fc87` → `54ccfa1`
**Workspace tests**: 612/612 green ✓
**Sprint exit criteria**: 5/6 met (NOTES.md update missing)

---

## Overall Assessment

Strong substrate ship — the adapter quartet + engine activities + MCP surface is functionally complete and well-tested at 137 new tests. Architecture aligns with SDD §3-§5. Cross-pack Tag identity strings are correctly published as load-bearing constants per A2.

**However**, the review surfaced **9 blocking issues** and **6 non-critical concerns**. The blockers cluster in three areas:

1. **Sprint plan amendments from Flatline-SDD-Round-1 were not addressed.** Fix-S4 (KeyProviderPort), Fix-S5 (RewardPort atomicity black-box conformance), Fix-S6 (jti LRU bound + AuthReplayStore port), Fix-S7 (KeySetProvider port + rotation states), and IMP-005 (kid rotation tests) were all folded into T1.16, T2.4, and T2.11 in §12.3-§12.4 of the sprint plan. None of these amendments shipped.

2. **Two real code defects with diagnostic / correctness impact** — `CASFailed` payload carries identical `expected_version` and `actual_version` (zero information for callers); `read(partition, after_sequence < 0)` silently returns all events instead of rejecting.

3. **Cross-runtime hashing discipline broken in cursor signer.** The cursor uses `JSON.stringify` instead of the protocol's canonical `canonicalizeJCS` (RFC 8785). The "double-SHA256 concat" hack to reach 128 hex chars provides false confidence about Ed25519 properties and is not portable to a real Ed25519 signer.

4. **Sprint exit criterion: NOTES.md update with S2 close — not done.**

Sprint-2 cannot close until these are addressed. Per §12.3 Fix-S8: *"security work (T1.16-T1.19 + T2.11-T2.14) requires minimum 24hr soak before sprint close (no same-day-merge-and-close)"* — so don't rush; iterate properly.

---

## Critical Issues (Blocking)

### C1 — Fix-S6 jti tracker missing memory cap (T2.11 amendment)

**Severity**: HIGH · **Category**: security / DoS resistance

Sprint plan §12.3 Fix-S6 amends T2.11 to require:
> *"(a) bounded LRU with explicit memory cap (default 10000 jtis OR 1-hour TTL whichever first) · (b) cold-start = reject-all-until-window-elapses (NOT persisted by default) · (c) production interface defined: `AuthReplayStore` port (Redis SETEX implementation expected)"*

Current implementation in `packages/mcp-tools/src/auth/bearer-token.ts:109-138`:
- Has TTL-based GC only — no memory cap.
- A malicious caller emitting tokens with random jti values (each unique) would grow the map unboundedly within the window.
- No cold-start posture (current impl accepts all jtis on cold start).
- `AuthReplayStore` port interface does not exist anywhere in the workspace.

**Required**:
1. Add memory cap to `makeInMemoryJTIReplayTracker` (default 10000 jtis · evict LRU when full · documented at config surface).
2. Define `AuthReplayStore` port interface in `packages/protocol/src/auth/` or `packages/ports/` (per workspace convention). Production Redis adapter consumes this port.
3. Add cold-start posture: a `coldStartUntilMs?: number` config field that, when present, causes `record` to return `{ fresh: false, ... }` until that wall-clock time. Test: cold-start window rejects all jtis even if not yet seen.
4. Document the rotation states (active · grace · revoked) for AuthReplayStore consumers in inline TSDoc.

`grep -rn "AuthReplayStore" packages/ --include="*.ts"` currently returns zero matches.

---

### C2 — Fix-S4 KeyProviderPort interface missing (T1.16 + T2.11 amendments)

**Severity**: HIGH · **Category**: security / production architecture

Sprint plan §12.3 Fix-S4:
> *"NEW S1.T1.16b: define `KeyProviderPort` interface (per-world-supplied · supports array of active keys for rotation) · T1.16 BearerToken validator consumes via Layer"*

Plus Fix-S7:
> *"define `AuthReplayStore` + `KeySetProvider` interfaces in S1 · conformance tests for distributed replay behavior · rotation states documented (active · grace · revoked)"*

Plus IMP-005 (auto-integrated):
> *"T1.16 amendment + T2.11 amendment: tests for kid mid-rotation · expired key rejected · revoked key rejected · active + grace overlap window works"*

Current state:
- The bearer-token validator has a `SignatureVerifier` seam at `bearer-token.ts:91-95` — but this is a single-key, single-state shape. It cannot express the active+grace+revoked tri-state required for rotation.
- `acceptAllSignatureVerifier` accepts every signature (test fixture) but production worlds will need a `KeyProviderPort` that resolves `kid` → key → state. Without this interface defined in the substrate, every world will roll its own and the substrate can't enforce rotation invariants.
- Tests do not cover kid rotation, expired key rejection, revoked key rejection, or active+grace overlap.

**Required**:
1. Define `KeyProviderPort` interface (preferred location: `packages/protocol/src/auth/KeyProviderPort.ts`). Surface:
   - `resolveKey(kid: string): Effect<KeyState, KeyProviderError>` where `KeyState = { key: bytes, state: "active" | "grace" | "revoked", expires_at: RFC3339Date }`
   - Sealed error union: `KidNotFound · KeyExpired · KeyRevoked · ProviderUnavailable`
2. Refactor `SignatureVerifier` to consume `KeyProviderPort` (or replace `SignatureVerifier` entirely with a `KeyProviderPort`-driven verifier).
3. Add 4 tests to `bearer-token.test.ts`:
   - kid resolves to active key → ok
   - kid resolves to grace-period key → ok (within grace window)
   - kid resolves to revoked key → `TokenSignatureInvalid` (or new variant)
   - kid not found → `TokenSignatureInvalid` with specific cause

This is foundation for production deployment. If we ship sprint-2 without it, every world that consumes MCP auth will copy-paste a one-off resolver.

---

### C3 — Fix-S5 RewardPort atomicity contract + black-box conformance (T2.4 + NEW T2.4b)

**Severity**: HIGH · **Category**: adapter conformance / production readiness

Sprint plan §12.3 Fix-S5 amends T2.4 and adds a NEW T2.4b:
> *"formal RewardPort atomicity contract spec (compare-and-set behavior · idempotency-key semantics · reusable black-box conformance test) · in-memory adapter is REFERENCE not normative · postgres-adapter-conformance test stub added (run only when adapter exists)"*

Current state at `packages/adapters/src/in-memory/__tests__/reward-idempotency.test.ts`:
- Tests directly import `makeInMemoryRewardPort` — they are NOT a reusable black-box suite. A postgres adapter could not drop in and re-run these tests.
- Contrast with how the implementer (correctly) framed event-store-conformance.test.ts in the reviewer.md as "the canonical adapter conformance gate" — but THAT file also imports `makeInMemoryEventStore` directly. Neither is actually a black-box suite.

**Required**:
1. Refactor both conformance suites to factory shape:
   ```typescript
   export const runEventStoreConformanceSuite = (
     factory: () => InMemoryEventStoreHandle,  // or generic adapter handle
   ) => { /* describe + it blocks here */ }
   ```
   In-memory test file calls `runEventStoreConformanceSuite(() => makeInMemoryEventStore())`. Future postgres test file imports the same suite and calls it with its factory.
2. Same shape for `reward-idempotency.test.ts` → `runRewardPortConformanceSuite(factory)`.
3. Add `postgres-adapter-conformance.test.ts` stubs (one per port) at `packages/adapters/src/postgres/__tests__/` (or comparable location) that import the suite and are marked `.skip` until the postgres adapter exists. This is the placeholder that makes T2.4b acceptance criterion ("postgres-adapter-conformance test stub added · run only when adapter exists") verifiable.
4. Document the RewardPort atomicity contract in `packages/protocol/src/ports/RewardPort.ts` TSDoc (compare-and-set semantics · idempotency-key surface · concurrent-write resolution).

---

### C4 — `CASFailed` payload carries identical expected/actual versions (bug)

**Severity**: MEDIUM · **Category**: diagnostic correctness

`packages/adapters/src/in-memory/completion-event.ts:163-170`:
```typescript
if (options.expected_tip_hash !== partition.tip) {
  return yield* Effect.fail(
    CASFailed.make({
      expected_version: partition.events.length,
      actual_version: partition.events.length,   // ← BUG: same as expected
    }),
  );
}
```

Both fields are `partition.events.length` — the caller learns nothing. The `expected_version` should reflect the CALLER's expectation (derivable from `options.expected_tip_hash` if the partition once held that tip, else 0/null), and `actual_version` should be the current `partition.events.length`. Otherwise the error is purely advisory and cannot drive retry decisions.

**Required**: Track per-partition sequence-by-tip so the caller's expectation can be reconstructed, OR change the `CASFailed` schema to surface tip hashes directly (`expected_tip` / `actual_tip` fields) which are immediately recoverable from `options.expected_tip_hash` and `partition.tip`. The schema currently lives in `packages/protocol/src/events/EventError.ts:39-42` — schema-level changes to CASFailed are a substrate decision worth documenting.

---

### C5 — Cursor signer uses `JSON.stringify` instead of `canonicalizeJCS` (cross-runtime correctness)

**Severity**: MEDIUM · **Category**: cross-runtime determinism

`packages/mcp-tools/src/pagination/cursor.ts:55-65`:
```typescript
const canonical = JSON.stringify({
  world_scope: payload.world_scope,
  caller_identity: payload.caller_identity,
  tool: payload.tool,
  filters_hash: payload.filters_hash,
  expires_at: payload.expires_at,
  page_position: payload.page_position,
});
```

The protocol pins JCS (RFC 8785) for ALL hashable content (T1.12 · `packages/protocol/src/encoding/jcs.ts`). The cursor signer uses raw `JSON.stringify`, which:
1. Does not enforce key ordering (V8 mostly preserves insertion but not guaranteed across engines)
2. Does not enforce number canonicalization
3. Differs from how Rust / Python / Go runtimes would serialize the same payload

If cursors must verify across runtimes (and they MUST, since production gateways may be in other languages), this is a determinism bug waiting to surface in cross-runtime conformance tests (sprint-3 T3.9 + T3.10).

**Required**: Use `canonicalizeJCS` from `@0xhoneyjar/quests-protocol` to produce the preimage. Add a test that asserts two byte-identical inputs in different key insertion orders produce the same signature.

---

### C6 — Cursor signer "shape-only" double-hash is misleading & not HMAC

**Severity**: MEDIUM · **Category**: misleading abstraction

`packages/mcp-tools/src/pagination/cursor.ts:53-78`:
```typescript
// SHA-256 produces 32 bytes / 64 hex; protocol pins to 128 hex (Ed25519).
// Double-hash + concatenate to reach 128 hex chars for shape compliance.
const second = await crypto.subtle.digest(...);
return bytes1 + bytes2;
```

Two problems:
1. **Comment claims this is "HMAC"** (`makeInMemoryCursorSigner` TSDoc line 36 says *"in-memory test signer wraps a deterministic HMAC"*). It is NOT HMAC. It is SHA-256 of `secret::canonical` — a length-extension-vulnerable construction. HMAC has specific keyed properties (inner/outer pad chains); this has none.
2. **Concat-to-fit-128-chars** simulates Ed25519's signature LENGTH but not its properties. A production swap to real Ed25519 will work because the shape matches, but tests written against this signer may unknowingly depend on properties Ed25519 doesn't have (e.g., the second-half hash includes a literal `"::round-2"` suffix that doesn't exist in real Ed25519).

**Required**:
1. Drop the false "HMAC" claim. Either implement actual HMAC-SHA256 (Web Crypto: `crypto.subtle.importKey` + `crypto.subtle.sign` with `{ name: "HMAC", hash: "SHA-256" }`) OR rename to "deterministic-test-signer" with explicit "NOT cryptographically equivalent to Ed25519" docstring.
2. Document the false-confidence risk in the TSDoc.
3. Optional: add a TODO marker pointing to where production Ed25519 swap-in lands.

---

### C7 — `read(partition, after_sequence < 0)` silently returns all events

**Severity**: LOW-MEDIUM · **Category**: input validation

`packages/adapters/src/in-memory/completion-event.ts:175`:
```typescript
read: (partition, after_sequence = 0) =>
  Effect.gen(function* () {
    /* ... */
    if (after_sequence < 0) return state.events.slice();
    return state.events.slice(after_sequence);
  }),
```

Negative `after_sequence` is silently coerced to "all events". A caller passing a buggy `-1` (e.g., from off-by-one arithmetic on a tip computation) reads the whole partition rather than getting a clear validation error.

**Required**: Reject negative inputs with `SchemaValidation` (or new `InvalidArgument`-shaped variant). Update the `EventStoreContract.read` TSDoc to spell out the precondition.

---

### C8 — Sprint exit criterion: NOTES.md update with S2 close

**Severity**: HIGH · **Category**: process / handoff

Sprint plan §3.3 exit criteria includes:
> *"- [ ] grimoires/loa/NOTES.md updated with S2 close"*

Current state: `grimoires/loa/NOTES.md` Session Continuity table ends at the sprint-1 cycle-7 close entry (2026-05-16T20:32Z). No sprint-2 entries.

**Required**: Append a sprint-2 close entry to Session Continuity that summarizes:
- 3 cycles · 15 tasks · 137 new tests · 4 commits.
- Acceptance-criteria coverage status (including the IMP-006 amendment that resolves T2.7's `⚠ Partial` to `✓ Met`).
- Deferred items with explicit rationale: T2.15 CMP-CONVENTION.md → T3.5, sprint-1 MED-001 still deferred, and the items raised in this review.
- Decision log entries for: the Tag identity strings (load-bearing per A2), the workspace dep wiring (`@0xhoneyjar/freeside-activities-adapters` as engine peer-dep), the in-memory raffle-tier policy location (mcp-tools vs engine).

---

### C9 — `reviewer.md` mischaracterizes T2.7 AC (per IMP-006)

**Severity**: LOW · **Category**: documentation accuracy

`grimoires/loa/a2a/sprint-2/reviewer.md` marks T2.7's "Emits ActivityLifecycleAdvanced events on transitions" as `⚠ Partial`.

Per sprint plan §12.4 IMP-006 (auto-integrated):
> *"T2.7 amendment: ActivityLifecycleAdvanced is an INTERNAL lifecycle signal (NOT a public EventEnvelope) · NOT persisted to event store · the cross-cutting lifecycle stream is `Activity.lifecycle_state` snapshots queried via getProgress"*

The pure state machine that returns the next state IS the entirety of T2.7's emission contract under IMP-006. The implementation is `✓ Met`, not `⚠ Partial`.

**Required**: Update the AC verification block in reviewer.md to cite IMP-006 and mark T2.7 as `✓ Met` with the citation. This is a small fix but important — the auditor will read the reviewer.md as a guide.

---

## Adversarial Analysis

### Concerns Identified (5)

1. **Sprint plan amendments dropped silently** (C1-C3). The Flatline-SDD-Round-1 amendments are the ONLY mechanism Loa has for "we found this in review and folded it in." If amendments don't make it into the implementer's task list, the protocol degrades to "implement what the original sprint table said and ignore what Flatline added." The amendments table at `sprint.md:343-369` is the source of truth.

2. **Reviewer.md positions both conformance test files as adapter-conformance gates** but neither actually is one — they're tied to the in-memory adapter via direct import. A reader of the reviewer.md will believe a postgres adapter could drop in and run them. It cannot.

3. **Cursor signer's shape-only crypto** (C6) is the sort of dev-fixture that catches reviewers off-guard. The 128-hex-char output makes downstream Schema validation pass, so an integration test that depends on shape will silently keep passing when a developer accidentally ships the test signer to prod.

4. **`isMutatingEvent` substring matching is fragile** (`packages/protocol/src/events/compute-event-id.ts:19-37`). It searches `$id` for fragments like `"progress-advanced"`. A future event type with a name overlap (e.g., `"x-progress-advanced-rollup"`) would falsely classify as mutating. Substring matching for security-relevant classification is a smell — better as an exact-match enum or schema literal.

5. **`grants` Map collision via `as unknown as string`** in reward adapter (`reward.ts:14-15`). The `idempotencyKey` joins two branded strings with `::`. Two identities `id_a::evil` and `id_a` colliding with event_id `evil` (after the `::` separator) could produce the same key. Highly unlikely with the current brand patterns (alphanumeric only, no `::`) but the separator choice deserves a comment defending the impossibility.

### Assumptions Challenged

- **Assumption**: "In-memory adapters never need real concurrency simulation because JS is single-threaded."
- **Risk if wrong**: The acceptance criteria says *"concurrent-grant race → only one wins"*. The current tests verify sequential idempotency. They do NOT verify what happens when two `port.grant(...)` Effects are zipped with `Effect.all`/`Promise.all` and race on the in-memory adapter. For in-memory the answer is "one definitely wins" because the Effect runtime schedules them sequentially — but the test should DEMONSTRATE this, not assume it. When the postgres adapter ships, this test SHAPE (race two grants, assert exactly one returns RewardGranted and the other returns AlreadyGranted) is the load-bearing case.
- **Recommendation**: Add an explicit concurrency test using `Effect.all([port.grant(...), port.grant(...)], { concurrency: "unbounded" })` and assert the result shape. Document that this is the contract postgres must satisfy.

### Alternatives Not Considered

- **Alternative**: Conformance tests as exported `describeAdapterConformance(factory)` functions.
- **Tradeoff**: Slightly more abstraction in the test files (a function wrapping describe blocks) BUT future adapter authors can import-and-call instead of copy-paste. This was called out in Fix-S5 + IMP-003 + the postgres conformance stub — and it's the difference between "the in-memory adapter has good tests" and "the substrate publishes an adapter conformance contract." Sprint-2 frames the latter; the implementation delivers the former.
- **Verdict**: **Should reconsider**. The factory pattern is small and unlocks the postgres-stub task in sprint-3 cleanly.

---

## Non-Critical Improvements (Recommended)

### N1 — Substring matching in `isMutatingEvent` is fragile

`packages/protocol/src/events/compute-event-id.ts:31-38` uses `event.$id.includes(fragment)` against an array of substrings. Replace with exact-match against the literal `$id` values from each event Schema's `$id: Schema.Literal(...)`. This is a sprint-1 artifact but surfaces in sprint-2 because the adapter relies on it for Fix-A1 enforcement.

### N2 — Document the `::` separator choice in `recordKey` and `idempotencyKey`

`packages/adapters/src/in-memory/progress.ts:7-8` and `packages/adapters/src/in-memory/reward.ts:13-16` both use `::` as the join separator. Since branded patterns reject `::`, collision is impossible — but a one-line comment documenting that defense would help.

### N3 — `validateBearerToken` records jti AFTER all checks pass

`packages/mcp-tools/src/auth/bearer-token.ts:217-225`: replay tracker is recorded as the LAST step. A caller probing for valid jtis (correct schema + valid time + valid scope + valid permission) would only burn jtis on full validation success. This is actually correct security posture (don't burn valid jtis on invalid requests) — but worth a TSDoc note explaining the ordering choice.

### N4 — `world_foo` brand pattern collision risk in audit-log tests

`packages/mcp-tools/src/__tests__/audit-log.test.ts:17` uses `world_foo`. The WorldId pattern is `^world_[a-z0-9_-]{1,64}$`. Fine for tests, but document that test-fixture world IDs all start with `world_` so an audit-log records `world: "world_foo"` not just `"foo"`. Helps future readers grep audit logs by world prefix.

### N5 — `read(partition)` returns an unordered snapshot for the empty case

`packages/adapters/src/in-memory/completion-event.ts:172-176` returns `state.events.slice()` for empty / negative slices. The `slice()` produces an array — consistent with the return type — but the empty-partition branch returns the typed `[]` cast. Worth a single-line type assertion or explicit `<EventEnvelope[]>[]` for clarity.

### N6 — Cursor `encodeCursor` uses Node's Buffer (env coupling)

`packages/mcp-tools/src/pagination/cursor.ts:103-107` and `:127-130` use `Buffer.from(...).toString("base64url")`. This works in Node + Bun but not in browser environments. The MCP transport is currently `stdio` (Node only), so this is fine — but if a future browser-side adapter consumes cursors, it'll need a polyfill or platform shim. Either add a TSDoc note documenting the Node-only assumption, or use the browser-compatible `btoa` / `atob` family (with `Uint8Array` translation).

---

## Previous Feedback Status

No prior `engineer-feedback.md` exists for sprint-2 — this is the first review iteration.

Sprint-1's `MED-001` (EventEnvelope strict-preimage hardening) is **still deferred** and not addressed in sprint-2. That deferral was approved at sprint-1 audit and remains acceptable; flag it again at sprint-2 audit.

---

## Incomplete Tasks

None of the 15 sprint-2 tasks are functionally incomplete in terms of file deliverables. The blockers above are amendment-coverage gaps + bugs + cross-runtime correctness, not missing files.

`sprint.md` task-table checkmarks will NOT be added until the blockers above are addressed.

---

## Next Steps

1. **Address C1-C3** (Fix-S4 + Fix-S5 + Fix-S6 + Fix-S7 + IMP-005). These are the largest items — expect ~4-6 new files (`KeyProviderPort.ts` · `AuthReplayStore.ts` · refactored conformance suites · postgres stubs) and ~10 new tests.
2. **Fix C4-C7** (4 code/correctness defects). Smaller — under an hour each.
3. **Fix C8-C9** (NOTES.md + reviewer.md AC verification update).
4. **Re-run** `bunx vitest run` (expect new count ≥620 after C1-C3 add tests).
5. **Update** this feedback file's "Previous Feedback Status" section in the reviewer.md addressed-section.
6. **Re-invoke** `/review-sprint sprint-2` for a second pass.

After approval here, security audit (`/audit-sprint sprint-2`) gets to look at the auth surface with the rotation + replay contracts in place.

---

## Cross-Model Observations

Adversarial cross-model review was NOT invoked in this pass (`flatline_protocol.code_review.enabled` was not verified). If the cycle requires a second model perspective on the auth/cursor surfaces, run `/flatline-review` against `packages/mcp-tools/src/auth/` before sprint-2 audit.

---

**Verdict**: CHANGES REQUIRED. Sprint-2 is functionally strong but cannot close until amendment coverage + 4 code defects + sprint exit criterion are addressed. Estimated work: ~half-day.
