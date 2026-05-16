---
status: approved-with-concerns
type: review-feedback
cycle: acvp-modules-genesis
sprint: sprint-1
sprint_global_id: bd-2wa
reviewer: claude-opus-4-7 (autonomous)
review_date: 2026-05-16
implementation_cycles: 7
final_test_count: 475
---

# Sprint-1 Review Feedback

All good (with documented concerns)

## Overall Assessment

Sprint-1 lands the sealed-schema substrate cleanly. 20/20 tasks complete with 475 passing tests across 21 test files (was 175 baseline + 300 new ACVP-substrate). Typecheck clean across 4 packages. Lint clean (biome scope honored). Sprint goal achieved: an agent or world can now import `@0xhoneyjar/freeside-activities/protocol` and `@0xhoneyjar/freeside-activities/ports` to author Activity definitions and reason about ports/events.

**Approval is conditional on the documented concerns below being acknowledged.** None block merge — they are framework-level discoveries, deferred-by-design scope items, or future-hardening opportunities. All concerns are traceable to NOTES.md Decision Log entries or sprint plan §2.3/3.2/4.2.

## Code Quality Assessment

| Dimension | Verdict | Evidence |
|---|---|---|
| **Completeness** | ✓ All 20 tasks landed | reviewer.md §Task-level ACs |
| **Test coverage** | ✓ 475 tests · meaningful assertions · golden vectors lock cross-runtime promise | 21 test files · 86 golden-vector assertions · 100-invocation determinism on computeEventId |
| **Security surface** | ⚠ See Adversarial Analysis #1, #2 | EventEnvelope loose-mode + isMutatingEvent substring matching |
| **Karpathy: Think Before Coding** | ✓ Decision Log captures rationale | NOTES.md 13 entries |
| **Karpathy: Simplicity First** | ✓ No speculative abstractions · preimage schemas are documentation refinement | T1.8 ships shape-validation only · runtime path stays the same |
| **Karpathy: Surgical Changes** | ✓ Each cycle scoped to its tasks | git log shows 7 commits each targeting specific T1.x range |
| **Karpathy: Goal-Driven** | ✓ Sprint goal achieved · ACs verified | §AC Verification table refreshed at cycle-7 close |
| **Architecture alignment with SDD** | ✓ All §3.x types implemented · §5.x algorithms verified | Re-read SDD against code — no drift |
| **Documentation** | ✓ NOTES.md current · Decision Log captures non-obvious choices · reviewer.md reflects final state | 8 progress entries + 13 decision entries |

## Adversarial Analysis

### Concerns Identified (5 — exceeds minimum 3)

1. **EventEnvelope is loose-by-default; canonical preimage hashes raw input** — `packages/protocol/src/events/EventEnvelope.ts:43` declares `Schema.Struct(eventEnvelopeFields)` with no extra-field rejection. `compute-event-id.ts:44-47` extracts the preimage from a `Record<string, unknown>` BEFORE schema decode — meaning attacker-supplied extra fields in an event payload get JCS-canonicalized + hashed even though schema decode would silently strip them. Attack vector: producer adds `"injected": "evil"` → substrate stores envelope without it → but the on-chain `event_id` IS contaminated. Severity: MEDIUM (only matters if a malicious producer attacks the hash binding contract). Mitigation: apply `Schema.filter` to reject unknown keys on the canonical-preimage boundary in a substrate-hardening cycle, OR pre-decode → re-canonicalize via the schema-validated object only. Documented in NOTES.md (Loose-struct decoding Decision Log entry · 2026-05-16) but the attack-surface implication is NOT yet documented.

2. **`isMutatingEvent` uses substring matching of `$id`** — `compute-event-id.ts:19-38` uses `event.$id.includes(fragment)` against fragments `["activity-completed", "badge-issued", "raffle-drawn", "progress-advanced", "reward-pending"]`. A maliciously-crafted `$id` like `"https://schemas.evil/some-non-activity-completed-but-mentions-the-string/v1.0.0"` would match. Severity: LOW (caller controls `$id` and the substrate doesn't trust untrusted producers anyway; the schema's `$id: Schema.Literal(...)` on each event type pins the legitimate ids). But the helper IS exported and could be called on non-validated input. Recommend: prefix-match on the canonical schema URL prefix (`https://schemas.freeside.thj/`) before substring checking, OR switch to exact-match against the literal set of mutating event `$id` values.

3. **Golden vectors lock IMPLEMENTATION, not SPEC** — `golden-vectors/_seed.ts` produces expected hashes using OUR specific RFC 8785 implementation (`canonicalize` npm pkg + `crypto.subtle` SHA-256). The "cross-runtime determinism" claim is only as strong as the spec adherence of this implementation. A Rust port using a different RFC 8785 implementation MIGHT produce different hashes if the two implementations disagree on edge cases (number canonicalization · unicode normalization · key-ordering on non-ASCII keys). Recommend: in S3 (T3.4 ACVP-MATRIX) cite the RFC 8785 reference test suite + run our `canonicalizeJCS` against those vectors as an external conformance assertion.

4. **No fuzz / property-based testing for branded types** — `packages/protocol/src/branded/branded.test.ts` is example-based (30 tests over 9 brands). A malformed input that happens to match the regex BUT exploits a parser edge case (e.g., a 130-char string with a single boundary-condition character) wouldn't be caught. Severity: LOW. Recommend: add `fast-check` or similar in a future substrate-hardening cycle; not blocking for sprint-1.

5. **Reward async-machine invariants documented but not verified at the protocol layer** — T1.6 ships RewardState sealed union + RewardPending/Granted/Failed structs. The state transition rules (CL-Reward-2: every reward emits Pending FIRST · only on confirmed delivery transitions to Granted) are documented in JSDoc but enforced by S2 `packages/engine/retry.ts` (T2.8). At the protocol layer there's no test like "a RewardGranted without a prior RewardPending is invalid". Scope-split: T2.8 enforces this. Acceptable for sprint-1 (protocol = shape; engine = behavior).

### Assumptions Challenged (1 — minimum 1)

- **Assumption**: "Schema.Struct loose-by-default is OK because sealed-union discipline catches misuse via `_tag`."
- **Risk if wrong**: Sealed-union discipline ONLY catches misuse for tagged structs. `EventEnvelope`, `StepCompletion`, `ProgressRecord`, `Cursor`, `CursorPayload`, and `WorldDefinedPayload` are NON-tagged structs. Attacker-supplied extra fields silently pass through schema decode. The hash-binding contract (CL-Event-3) is INVARIANT against the post-decode envelope but VARIANT against the pre-decode raw input — and the canonical preimage hashes the pre-decode raw input.
- **Recommendation**: Either (a) make the canonical-preimage path go through Schema decode first, ensuring extra fields are stripped before hashing, OR (b) add an explicit `Schema.filter` rejecting unknown keys on the canonical-preimage boundary, OR (c) document the attack-surface limitation in `compute-event-id.ts` JSDoc with a clear "pre-decode hashing is intentional; producers MUST NOT add extra fields to events" contract.

### Alternatives Not Considered (1 — minimum 1)

- **Alternative**: Strict-mode `Schema.Struct` everywhere via custom helper `strictStruct(fields)` that wraps Schema.Struct + Schema.filter(rejectUnknownKeys).
- **Tradeoff**: Stricter validation may break legitimate forward-compat schema additions in minor versions (adding a new optional field to ActivityCompleted would break decode on existing data). The current loose default preserves backwards compat.
- **Verdict**: Current loose-by-default approach is justified BECAUSE forward-compat in minor versions is the dominant case. Strict-mode is the right call ONLY on the canonical-preimage boundary (which I'd document as a separate concern · see Adversarial #1). Do NOT make all schemas strict.

## Previous Feedback Status

No prior `engineer-feedback.md` for this sprint — this is the first review pass (cycles 1-6 were partial-completion handoffs via `reviewer.md` only).

## Adversarial Cross-Model Review (Phase 2.5)

**Status**: SKIPPED — `flatline_protocol.code_review.enabled` is not set in `.loa.config.yaml` (defaults to false). Manual `/flatline-review` invocation against the sprint-1 substrate is the operator's call. Recommend running it before sprint-2 begins, since the EventEnvelope strict-mode + isMutatingEvent concerns above warrant a second-model perspective.

To enable for future sprints:
```yaml
# .loa.config.yaml
flatline_protocol:
  code_review:
    enabled: true
    model: gpt-5.4-codex   # or claude-opus-4-7
    budget_cents: 50
    timeout_seconds: 120
```

## Subagent Report Check

No reports in `grimoires/loa/a2a/subagent-reports/` — `/validate` was not run for this sprint (optional step). Recommend running `/validate docs` + `/validate architecture` before `/ship` to surface any documentation drift the cycle-7 sprint-close didn't catch.

## Complexity Analysis

Spot-checked the highest-leverage files:
- `compute-event-id.ts` (143 lines · 4 small functions · max 5 params) — well within thresholds
- `golden-vectors/golden-vectors.test.ts` (150 lines · iterator pattern · no nesting >3) — clean
- `branded.test.ts` (30 tests · helper `stringCase` parameterizes 8 brands) — DRY
- `events.test.ts` (390 lines · 32 tests across 5 describe blocks) — well-organized

No duplication, no dead code, no circular dependencies detected. Naming is consistent (TaggedStruct discriminator `_tag`, branded types use the brand name itself).

## Non-Critical Improvements (Recommended for Sprint-2 or Future)

| Item | Where | Action |
|---|---|---|
| Document the canonical-preimage attack surface | `compute-event-id.ts` JSDoc on `computeEventId` | Add a "Producer Contract" section explaining that pre-decode hashing means producers must validate their event shape before passing to computeEventId |
| Switch `isMutatingEvent` to exact-match on event `$id` literal set | `compute-event-id.ts:31-38` | Replace `event.$id.includes(fragment)` with `MUTATING_EVENT_IDS.has(event.$id)` after defining the literal set |
| Add RFC 8785 conformance check | S3 T3.4 ACVP-MATRIX | Cite + run RFC 8785 reference test vectors against our `canonicalizeJCS` |
| Property-based tests for branded types | Future substrate-hardening cycle | Add `fast-check` for regex pattern boundaries |
| Strict-mode opt-in helper | Future cycle | Add `strictStruct(fields)` helper for callers who explicitly want strict validation |

## Incomplete Tasks

None. All 20 tasks T1.1-T1.20 are landed with green tests. The `⏸ ACCEPTED-DEFERRED` items in the §AC Verification table (package rename · compass/cubquests full roundtrip · Effect.Schema strict-mode framework-level) have explicit scope-splits to S3 tasks or Decision Log entries.

## Next Steps

1. **Run `/audit-sprint sprint-1`** (security + quality audit gate · creates COMPLETED marker on approval)
2. After audit approval, **begin sprint-2 (T2.1 ProgressPort in-memory adapter)** — cycle-6 close note recommends sprint-2 as a fresh-session boundary; this session has accumulated substantial context across 7 implementation cycles + 1 review cycle. Operator may choose to open a new session for sprint-2.
3. **(Optional)** Run `/flatline-review` against `packages/protocol/src/events/compute-event-id.ts` + `EventEnvelope.ts` to get a second-model perspective on Adversarial Concern #1 + #2 before they propagate to sprint-2 adapter conformance.
4. **(Optional)** In sprint-2, address Adversarial Concern #2 (exact-match `isMutatingEvent`) — it's a 5-line change and removes a low-severity attack-surface; appropriate to bundle with T2.3 (Fix-A1 nonce enforcement in adapter).

## Sprint Approval Statement

**Sprint-1 approved.** The substrate is production-ready for sprint-2 adapter work to build on. The 5 concerns in §Adversarial Analysis are documented for future hardening and do not block sprint-2.

Sprint task checkmarks applied to `sprint.md`. Ready for `/audit-sprint sprint-1`.
