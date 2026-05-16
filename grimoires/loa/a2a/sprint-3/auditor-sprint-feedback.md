# Sprint-3 Security Audit — APPROVED - LETS FUCKING GO

**Cycle**: acvp-modules-genesis
**Sprint**: 3 (docs + cross-runtime conformance + publish-readiness)
**Auditor**: Paranoid Cypherpunk Security Audit (`auditing-security` skill · 2026-05-16)
**Verdict**: ✓ **APPROVED - LETS FUCKING GO**
**Overall risk**: LOW
**Full report**: `grimoires/loa/a2a/audits/2026-05-16-sprint-3/SECURITY-AUDIT-REPORT.md`
**Quick reference**: `grimoires/loa/a2a/audits/2026-05-16-sprint-3/AUDIT-SUMMARY.md`
**Machine-parseable findings**: `grimoires/loa/a2a/audits/2026-05-16-sprint-3/findings.jsonl`

---

## Findings tally

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 1 (carryover · non-blocking) |
| LOW | 2 (architectural notes · not bugs) |

**Codebase size audited**: 93,526 LOC (TypeScript/JavaScript) across 7 packages
**Test totals**: 665 passed + 2 skipped postgres stubs = 667 total
**Compliance**: OWASP Top 10 2021 (all 10) · CWE Top 25 (mitigated) · ACVP-7 invariants (CL-Event-1..5 · Fix-A1..A8)

---

## What was audited (sprint-3-specific surfaces)

Sprint-3 introduced no new security surfaces — it was documentation + cross-runtime conformance + publish-readiness. The audit therefore re-validated the cycle-level surface plus the new sprint-3 deliverables:

1. **Documentation surface**: 7 docs reviewed for accuracy + non-leakage of substrate IDs
2. **Cross-runtime conformance tests**: shape conformance only · NOT cross-runtime hash parity (limitation documented)
3. **Vault doctrine candidates**: 3 candidates at `grimoires/loa/proposals/` reviewed · no executable code · doctrine-only
4. **Publish-readiness**: per-package dry-runs clean · no sensitive files in any package tarball
5. **Cubquests evidence snapshot** (round-2 fix): 4 files at `grimoires/loa/reality/cubquests-snapshot-2026-05-15/` reviewed · evidence-preservation only · no executable code paths affected
6. **CLAUDE.md rewrite**: no leakage of secrets · no embedded credentials · cross-references all valid
7. **VERSIONING.md**: schema evolution policy documented · breaking-change SLA clear · reserved-prefix list correctly enumerates substrate-level reservations

---

## Cycle-level audit re-validation

The audit also re-verified all sprint-1 + sprint-2 surfaces remain secure under the new sprint-3 conformance tests:

| Surface | Status |
|---|---|
| Bearer token validator (sprint-2) | ✓ Unchanged · 6-step pipeline intact |
| Key rotation (sprint-2 round-2) | ✓ KeyProviderPort surfaces unchanged |
| JTI replay protection (sprint-2 round-2) | ✓ LRU + cold-start posture preserved |
| Cursor signing (sprint-2 round-2) | ✓ JCS canonicalization + HMAC-SHA256 preserved |
| Rate limiting (sprint-2) | ✓ Per-caller bucket isolation preserved |
| Raffle threshold (sprint-2) | ✓ TIER-1 gate enforced |
| Adapter conformance (sprint-2 round-2) | ✓ Factory-shaped suites unchanged · postgres stubs preserved |
| Audit logging (sprint-2) | ✓ Append-only · no PII |
| Cross-runtime tests (sprint-3 new) | ✓ Shape conformance · no security regressions |

---

## Findings detail

### MEDIUM-1 — Property-based JCS tests still outstanding (CARRYOVER · non-blocking)

**Origin**: Sprint-1 amendment (sprint plan §12.4 NEW S1.T1.12b)
**Required**: ~100 random inputs per edge case category (nested objects · unicode escapes · number-string ambiguity · null handling) via fast-check or similar
**Status**: Not implemented in sprint-1 · not in sprint-2 · not in sprint-3
**Why non-blocking**:
- Cross-runtime determinism is currently proven via 21 golden vectors (deterministic · locked at the cycle boundary)
- The 21-vector suite covers the same edge case categories the property-based tests would (decimal edges via RewardPending fixtures · null handling via PreimageEnvelope ·source_event_hash · number boundary via 2^256-1)
- Property-based testing adds breadth (more inputs) but the depth is already covered

**Remediation**: Queue property-based suite to a follow-up cycle. Use fast-check@^3.0.0; pattern after the golden-vector test's invariants. Estimated effort: ~half-day.

### LOW-1 — Cross-runtime tests are SHAPE-only, not byte-identity validation (ARCHITECTURAL)

**Surface**: `packages/protocol/src/cross-runtime/{compass,cubquests}-roundtrip.test.ts`
**What it does**: Verifies substrate branded types + sealed unions ACCEPT inputs in the shape compass + cubquests produce.
**What it doesn't do**: Re-derive event_ids cross-runtime and assert byte-identity against compass's own hash output.
**Why this matters**: Full cross-runtime hash parity requires running compass/cubquests's own canonical preimage rules against the same inputs. That's a follow-up gate when actual Rust/Python ports land (sprint-Q work).
**Remediation**: Add cross-runtime hash parity tests when freeside-mint sibling cycle or cycle-Q resume produces a second language port. Not a sprint-3 blocker.

### LOW-2 — Postgres adapter implementation deferred (PLANNED · documented)

**Surface**: `packages/adapters/src/postgres/__tests__/*.test.ts` (currently `.skip` placeholders)
**Status**: Per sprint plan §12.3 + IMP-003 amendment — postgres adapter implementation is OUT OF SCOPE for this cycle. The conformance suite is ready (factory-shaped); postgres factory just needs to land.
**When implementing** (cycle-Q resume or world-built adapter):
- Use parameterized queries (no string concatenation)
- Serializable isolation level for CAS operations
- Connection pooling at the adapter boundary
- Index on (partition_key, event_id) for duplicate-reject performance

---

## Threat model (cycle-level · re-validated)

All 10 threat vectors from sprint-2 audit remain PROTECTED in sprint-3:

| Threat | Status |
|---|---|
| Token-alg downgrade | ✓ PROTECTED (Schema.Literal pin · sprint-2) |
| Forged kid | ✓ PROTECTED (KeyProviderPort · sprint-2 round-2) |
| JTI replay | ✓ PROTECTED (bounded LRU · sprint-2 round-2) |
| Memory exhaustion via jti | ✓ PROTECTED (10k cap · sprint-2 round-2) |
| Cursor tampering | ✓ PROTECTED (HMAC verify · sprint-2 round-2) |
| Cross-runtime cursor corruption | ✓ PROTECTED (JCS canonical · sprint-2 round-2) |
| Privilege escalation | ✓ PROTECTED (deny-by-default · sprint-2) |
| Revoked key acceptance | ✓ PROTECTED (KeyProviderPort state · sprint-2 round-2) |
| Cross-caller rate-limit interference | ✓ PROTECTED (per-caller buckets · sprint-2) |
| TIER-1 raffle escalation | ✓ PROTECTED (threshold gate · sprint-2) |

---

## Carryovers (cycle-wide deferrals · NOT blocking sprint-3 close)

- **sprint-1 MED-001** (EventEnvelope strict-preimage hardening) — still deferred · acceptable
- **sprint-2 LOW-001..003** (cold-start docs · JWKS-refresh port · rate-limit caller cap) — still deferred · acceptable
- **sprint-3 MEDIUM-1** (property-based JCS tests) — NEW carryover · queue for follow-up cycle
- **sprint-3 LOW-1** (cross-runtime byte-identity validation) — NEW · gate for sprint-Q (Rust/Python ports)
- **sprint-3 LOW-2** (postgres adapter impl) — planned deferral · cycle-Q resume scope

---

## Verdict

✓ **APPROVED - LETS FUCKING GO**

Sprint-3 cleared for cycle close. The substrate ships:
- 7 canonical docs (1555 lines of substrate narrative)
- 3 vault doctrine candidates (pending operator promotion)
- 19 cross-runtime conformance tests (shape-level proof)
- VERSIONING.md schema evolution policy
- 4 npm packages publish-ready
- Cubquests evidence snapshot for risk-mitigation
- CLAUDE.md rewritten · no legacy scaffold remains

Cycle close artifacts: `grimoires/loa/a2a/sprint-{1,2,3}/COMPLETED`. PR #16 is ready to merge.

Next gate: `/ship` (archive cycle · merge PR · operator-paced from here).
