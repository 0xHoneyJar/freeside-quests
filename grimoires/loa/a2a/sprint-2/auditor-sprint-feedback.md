# Sprint-2 Security Audit — APPROVED - LETS FUCKING GO

**Cycle**: acvp-modules-genesis
**Sprint**: 2 (adapters + MCP + engine)
**Auditor**: Paranoid Cypherpunk Security Audit (`auditing-security` skill · 2026-05-16)
**Verdict**: ✓ **APPROVED - LETS FUCKING GO**
**Overall risk**: LOW
**Full report**: `grimoires/loa/a2a/audits/2026-05-16/SECURITY-AUDIT-REPORT.md` (704 lines)
**Quick reference**: `grimoires/loa/a2a/audits/2026-05-16/AUDIT-SUMMARY.md`
**Machine-parseable findings**: `grimoires/loa/a2a/audits/2026-05-16/findings.jsonl`

---

## Findings tally

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 3 (non-blocking · sprint-3 polish candidates) |

**Security checklist**: 29/29 items PASSED
**Engineer review blockers (round 1)**: 9/9 verified resolved (C1-C9)
**Sprint exit criteria**: 7/7 met

---

## What was audited

Eight security-relevant surfaces shipped in sprint-2:

1. **Bearer token validator** (T2.11 + Fix-A3 + Fix-A4 + IMP-005) — 6-step pipeline (schema decode → signature verify → time bounds → world scope → tool RBAC → jti replay). Schema-level rejection of `alg:none` + `alg:HS*` confirmed.
2. **Key rotation** (Fix-S4 + Fix-S7 + IMP-005) — KeyProviderPort with active/grace/revoked tri-state · 8 rotation tests · KidNotFound + KeyExpired + KeyRevoked + KeyProviderUnavailable variants all reachable.
3. **JTI replay protection** (Fix-S6 + C1) — bounded LRU (10k jtis default) + TTL window + cold-start posture. AuthReplayStore port ready for Redis swap-in.
4. **Cursor signing** (T2.14 + C5 + C6) — RFC 8785 JCS canonicalization (cross-runtime determinism) · real Web Crypto HMAC-SHA256 · false "HMAC" claim from round 1 removed.
5. **Rate limiting** (T2.12) — token bucket per caller · integer-overflow safe · memory-bounded.
6. **Raffle threshold** (T2.15 + D25) — TIER-1 blocked above threshold unless opt-in flag · 14 tests cover all branches.
7. **Adapter conformance** (T2.1-T2.5 + C3) — factory-shaped suites portable to postgres · CASFailed payload reconstruction · negative `after_sequence` rejected.
8. **Audit logging** (T2.13) — append-only contract · no PII (args_hash only) · 8 outcome variants distinguish abuse signals.

---

## Threat model (key entries)

| Threat | Mitigation | Residual risk |
|---|---|---|
| Token-alg downgrade (`alg:none` / `alg:HS256`) | `Schema.Literal("Ed25519")` rejection at decode | VERY LOW |
| Forged `kid` | KeyProviderPort + signature verify required | VERY LOW |
| JTI replay within window | LRU tracker + 3600s window + cold-start option | VERY LOW |
| Memory exhaustion on jti | Bounded LRU at 10k entries · eviction before insert | VERY LOW |
| Cursor tampering | HMAC verification at every read | LOW |
| Cross-runtime cursor corruption | JCS canonicalization | VERY LOW |
| Privilege escalation via permissions | Explicit `permissions` array · deny-by-default | VERY LOW |
| Revoked key acceptance | KeyProviderPort state check | VERY LOW |
| Cross-caller rate-limit interference | Per-caller token-bucket isolation | VERY LOW |
| TIER-1 raffle escalation | Threshold gate (count > 10 OR reward_class ∈ {NFT, token}) | VERY LOW |

---

## Non-blocking LOW findings (sprint-3 polish candidates)

### LOW-001 · jti tracker cold-start defaults to accept-on-cold-start
**Surface**: `packages/mcp-tools/src/auth/bearer-token.ts:139-158`
Cold-start posture is opt-in via `coldStartUntilMs`. Default behavior accepts the first jti observation. Defensible — production warm-Redis caches make the window irrelevant — but document the recommendation for fresh-deploy operators in `packages/mcp-tools/SECURITY.md` (sprint-3 T3.x).

### LOW-002 · in-memory KeyProvider lacks JWKS refresh TTL
**Surface**: `packages/mcp-tools/src/auth/in-memory-key-provider.ts`
The fixture is TEST-FIXTURE-ONLY (already documented). Production worlds implement their own JWKS-refreshing KeyProvider. Worth adding a `RefreshableKeyProviderPort` extension in sprint-3 (with caching contract: TTL · staleness tolerance · refresh-on-miss) so production patterns converge.

### LOW-003 · rate-limit buckets accumulate indefinitely
**Surface**: `packages/mcp-tools/src/auth/rate-limit.ts:46-55`
The `Map<callerKey, Bucket>` grows over time as new callers appear. Acceptable for MCP-scale (per-world caller counts are bounded) and Redis swap-in handles expiry automatically. Sprint-3 polish: add a `maxCallers` config + LRU eviction matching the jti tracker pattern.

---

## Production readiness per component

| Component | Status | Production swap-in |
|---|---|---|
| Bearer token validator | ✓ Production-ready | Real Ed25519 verifier via SignatureVerifier seam |
| Key rotation | ✓ Production-ready | JWKS-backed KeyProviderPort |
| Replay protection | ✓ Production-ready | Redis AuthReplayStore (port defined) |
| Cursor signing | ✓ Production-ready | Ed25519 signer via CursorSigner seam |
| Rate limiting | ✓ Production-ready | Redis token-bucket via RateLimiter seam |
| Raffle threshold | ✓ Production-ready | Enforced at substrate boundary |
| Adapter conformance | ✓ Production-ready | Postgres factory drops into existing suites |
| Audit logging | ✓ Production-ready | Append-only JSONL sink contract published |

---

## Sprint-1 carryover

- **MED-001** (EventEnvelope strict-preimage hardening) — deferred from sprint-1 audit · not addressed in sprint-2 · remains acceptable deferral · re-flag at sprint-3 or wherever the implementation lands

---

## Verdict

✓ **APPROVED - LETS FUCKING GO**

Sprint-2 cleared for production deployment. All cryptographic invariants, replay protections, input validations, and authorization gates correctly implemented at schema + interface boundaries. The 3 LOW findings are polish items appropriate for sprint-3.

Next gate: sprint-2 closes with this approval. PR #16 may flip from draft → ready-for-review.
