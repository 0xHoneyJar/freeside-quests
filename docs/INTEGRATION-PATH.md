# INTEGRATION-PATH — adopting `freeside-activities` in a world

> Renamed from `freeside-quests` 2026-05-15. This is the staged-adoption guide for any
> freeside world that wants to compose the activities substrate (purupuru · honey-port ·
> mibera · future worlds). The sprint-2 substrate is production-ready for in-memory dev
> paths; production adapters (postgres · convex · etc) are world-built.

---

## tl;dr — the four-step adoption sequence

1. **Install** — declare `compose_with: @0xhoneyjar/quests-protocol` in your world-manifest + add the workspace deps
2. **Implement ports** — supply your world's `IdentityResolverPort` · production `EventStoreContract` adapter · `KeyProviderPort` · `AuthReplayStore`
3. **Register kinds** — declare which `ActivityKind` discriminants your world ships (built-ins + any `WorldDefined` kinds you author)
4. **Run conformance** — your adapters MUST pass the canonical conformance suites at `packages/adapters/src/conformance/` before the world goes live

---

## Step 1 — Install

### Workspace dependencies

Add to your world's `package.json`:

```json
{
  "dependencies": {
    "@0xhoneyjar/quests-protocol": "^0.1.2",
    "@0xhoneyjar/freeside-activities-adapters": "workspace:*",
    "@0xhoneyjar/freeside-activities-mcp-tools": "workspace:*",
    "@0xhoneyjar/quests-engine": "^0.1.2"
  },
  "peerDependencies": {
    "effect": "^3.12.0"
  }
}
```

### world-manifest.yaml

```yaml
# world-manifest.yaml in your freeside world
world_id: world_yourworld
schema_version: "1.0.0"

compose_with:
  - module: "@0xhoneyjar/quests-protocol"
    purpose: "Activity supertype schemas (sealed) + canonical preimage discipline"

  - module: "@0xhoneyjar/freeside-activities-mcp-tools"
    purpose: "Read-only agent surface (5 MCP tools)"

  - module: "@0xhoneyjar/quests-engine"
    purpose: "Effect Layer composition + lifecycle state machine + reward retry"

activity_kinds:
  builtin:
    - "quest"
    - "mission"
    - "badge-claim"
    - "raffle-entry"
  world_defined:
    # Each world-defined kind needs a sub-schema $id pointing at YOUR schema host
    # See VERSIONING.md for promotion-to-builtin SLA
    # Example:
    # - kind_id: "yourworld:custom-quest-shape"
    #   world_sub_schema_id: "https://schemas.yourworld.example/custom-quest/v1.0.0"

production_adapters:
  event_store: "@yourworld/postgres-event-store"
  reward_port: "@yourworld/postgres-reward-port"
  progress_port: "@yourworld/postgres-progress-port"
  identity_resolver: "@yourworld/privy-identity-resolver"

mcp_auth:
  key_provider: "@yourworld/jwks-key-provider"
  replay_store: "@yourworld/redis-replay-store"
  rate_limiter: "@yourworld/redis-rate-limiter"
```

### TypeScript composition root

```typescript
import { Effect, Layer } from "effect";
import { buildDefaultActivitiesLayer } from "@0xhoneyjar/quests-engine";
import {
  ProgressPortTag,
  IdentityResolverPortTag,
  RewardPortTag,
  CompletionEventPortTag,
} from "@0xhoneyjar/quests-engine";

// 1. Start with the substrate default (in-memory adapters)
const { layer: defaults } = buildDefaultActivitiesLayer();

// 2. Override individual ports with your production adapters
const productionLayer = Layer.mergeAll(
  defaults,
  Layer.succeed(IdentityResolverPortTag, yourPrivyResolver),
  Layer.succeed(CompletionEventPortTag, yourPostgresEventStore.port),
  Layer.succeed(RewardPortTag, yourPostgresRewardPort.port),
  Layer.succeed(ProgressPortTag, yourPostgresProgressPort.port),
);

// 3. All consumers (engine · MCP tools · your own routes) compose against this Layer
```

---

## Step 2 — Implement ports

### Required ports

Every world MUST supply real implementations of these four ports — the in-memory adapters are TEST/DEV fixtures only (A5 + `IdentityResolverPort.ts` doc comment).

| Port | Production implementation hints |
|---|---|
| `IdentityResolverPort` | Wrap your auth provider (Privy · Dynamic · Sietch) · the substrate is opaque about identity at the boundary |
| `EventStoreContract` + `CompletionEventPort` | Postgres with append-only events table + per-partition tip index · or Convex with mutation-based atomic-append · MUST pass `runEventStoreConformanceSuite` |
| `RewardPort` | Whatever issues your rewards (badge mint · token transfer · cosmetic grant) · D18 idempotency-by-(originating_event_id, recipient) tuple MUST be atomic at the storage layer |
| `ProgressPort` | Per-(activity, identity) state with version-counter optimistic concurrency · `advanceProgress` rejects with `ConcurrentUpdate` on version mismatch |

### MCP production seams (sprint-2 round-2 additions)

| Port | Production implementation hints |
|---|---|
| `KeyProviderPort` | JWKS-backed resolver — fetch your issuer's `/.well-known/freeside-mcp-jwks` · cache with TTL · expose active/grace/revoked tri-state |
| `AuthReplayStore` | Redis SETEX-shape — `SET jti 1 EX 3600 NX` atomic · returns `{ fresh: true }` on win |
| `RateLimiter` | Redis token-bucket — `INCRBY caller:bucket 1` + `EXPIRE` |

### Conformance: your adapters MUST pass the canonical suite

```typescript
// In your world's test suite
import { runEventStoreConformanceSuite } from "@0xhoneyjar/freeside-activities-adapters/conformance";
import { makeYourPostgresEventStore } from "./postgres-event-store.js";

runEventStoreConformanceSuite(
  (config) => {
    const handle = makeYourPostgresEventStore({ pool: testPool, ...config });
    return { contract: handle.contract, port: handle.port, clear: handle.clear };
  },
  "yourworld postgres adapter",
);
```

Same `describe`/`it` blocks · same invariants (CL-EventStore-1..7 + Fix-A1) · if your adapter passes, the substrate guarantees the invariants hold.

---

## Step 3 — Register kinds

The built-in `ActivityKind` sealed union covers four canonical shapes:

| Kind | Period model | Reward shape | Verification typical |
|---|---|---|---|
| `quest` | one-shot (period_key = null) | badge · token · cosmetic · external | manual-curator · signed-memo-tx · on-chain-event |
| `mission` | recurring (period_key = ISO-week) | same as quest | same as quest |
| `badge-claim` | one-shot (period_key = null) | badge-mint only | merkle-proof (off-chain snapshot → on-chain claim) |
| `raffle-entry` | season-bound (period_key = custom-cycle) | external (raffle ticket grant) | partner-api · webhook-hmac |

### `WorldDefined` extension

If your world needs a kind outside the built-in four, declare it via the `WorldDefinedKindId` brand:

- Format: `<world>:<kind>` (slug-style · each half ≤120 chars · ≤256 total)
- Reserved prefixes: `freeside-` · `loa-` · `core-` (rejected at substrate level)
- Substrate caps payload size at 16 KiB and nesting at 8 levels (D26)
- See `VERSIONING.md` for promotion-to-builtin SLA (when a world-defined kind earns its way into the substrate)

---

## Step 4 — Run conformance

### Adapter conformance gate

```bash
bunx vitest run packages/adapters/src/conformance
# → 13 EventStoreContract tests + 5 RewardPort tests
# → MUST pass before world goes live
```

### Cross-runtime determinism (sprint-3 deliverable)

The substrate ships 21 golden vectors at `packages/protocol/src/golden-vectors/`. Re-derive them in your runtime (Rust port · Python port · etc) and assert byte-identity:

```typescript
import { GOLDEN_VECTORS } from "@0xhoneyjar/quests-protocol/golden-vectors";

for (const vector of GOLDEN_VECTORS) {
  const computed = await computeEventId(vector.input);
  if (computed !== vector.expected_event_id) {
    throw new Error(`cross-runtime drift on ${vector.id}`);
  }
}
```

If your runtime produces drift, the bug is in your runtime — the substrate is the source of truth.

### MCP gateway validation contract

If your world hosts the MCP gateway:

1. Validate manifest at boot via `validateMCPManifest(JSON.parse(manifestJson))` (from `@0xhoneyjar/freeside-activities-mcp-tools`)
2. Validate every tool spec against the manifest contract — name MUST match spec basename · `$schema` MUST pin draft 2020-12 · `$id` MUST be under `https://schemas.freeside.thj/mcp/`
3. Reject any token with `alg !== "Ed25519"` at schema decode (the substrate already does this; defense-in-depth is your gateway's check)

---

## TIER-1 / TIER-2 / TIER-3 raffle threshold guidance

> **⚠ THREAT MODEL WARNING — READ BEFORE CONFIGURING RAFFLES ⚠**
>
> Raffles are **adversarial** — the design must assume a motivated attacker who controls
> their own RNG and will try to claim disproportionate winnings. The substrate enforces a
> threshold gate at `packages/mcp-tools/src/raffle-threshold.ts`:
>
> - **TIER-1 (PRNG-only)** — acceptable ONLY for low-stakes raffles. Threshold:
>   `reward_count > 10 OR reward_class ∈ {NFT, token}` triggers REJECTION unless the
>   cycle config declares `opt_in_tier_1_above_threshold: true` (operator override
>   with documented rationale).
>
> - **TIER-2 (block-hash anchored)** — externally-anchored randomness (e.g., post-draw
>   block hash from the chain you're indexing). Acceptable for medium-stakes. No
>   threshold.
>
> - **TIER-3 (VRF)** — Chainlink VRF or equivalent verifiable randomness. Required
>   for high-stakes (large NFT drops · significant token grants · season finale prizes).
>   No threshold.

### How to configure

```typescript
import { classifyRaffleTier } from "@0xhoneyjar/freeside-activities-mcp-tools";

const verdict = classifyRaffleTier({
  rewardClass: "NFT",
  rewardCount: 5,
  declaredTier: "TIER-2",  // escalation required above threshold
});

if (verdict._tag !== "ok") {
  // RaffleTierViolation — cycle config is invalid
  throw new Error(verdict.reason);
}
```

### Why the gate exists

Cubquests' production raffles already operate under PRNG-only (TIER-1) for low-stakes
weekly resource grants. That posture is fine for ≤10-prize cosmetic raffles where the
operator absorbs the residual integrity risk. It is NOT fine for NFT or token raffles
where the value-at-stake makes the gate the right place to fail closed.

The substrate refuses the misconfiguration at load time. Worlds that genuinely need
TIER-1 above threshold MUST set `opt_in_tier_1_above_threshold: true` explicitly — the
operator's signed acknowledgment that they accept the integrity risk.

See `[[weighted-raffle-draw-pattern]]` doctrine candidate (sprint-3 T3.8) for the full
3-tier spec including seed-publication invariants.

---

## Common pitfalls

### ❌ Don't reach across the boundary

```typescript
// WRONG — your world must NOT modify substrate-owned schema fields
const corrupted = { ...activity, kind: "your-custom-string" };
//                                ^^^^ violates sealed-union discipline
```

Use `WorldDefined` extension via `WorldDefinedKindId` brand instead.

### ❌ Don't write events without nonce

```typescript
// WRONG — mutating events MUST carry caller-supplied nonce (Fix-A1)
const event = { ...envelope, nonce: null };  // substrate rejects with NonceRequired
```

The substrate refuses derived-nonce fallback for mutating events. You MUST supply a
caller-controlled nonce so retries are idempotent.

### ❌ Don't bypass the IdentityResolverPort

```typescript
// WRONG — directly grabbing the chain address bypasses the substrate boundary (A5)
const addr = await privyClient.getWalletAddress(identityId);
```

Use the port:

```typescript
const program = Effect.gen(function* () {
  const resolver = yield* IdentityResolverPortTag;
  const addr = yield* resolver.resolveToChainAddress(identityId, "ethereum");
  return addr;
});
```

### ❌ Don't trust client-supplied event_id

```typescript
// WRONG — accepting client-asserted event_id without re-derivation
await eventStore.append(clientEvent, { partition_key: pk, expected_tip_hash: tip });
```

The in-memory adapter re-derives `event_id` via `computeEventId` and rejects mismatches
(`verifyEventId: true` default). Production adapters SHOULD too — defense in depth
against A6 violations.

---

## Adoption sequence checklist

| ✓ | Step |
|---|---|
| ☐ | World-manifest.yaml declares `compose_with: @0xhoneyjar/quests-protocol` |
| ☐ | Production `IdentityResolverPort` implemented + tested against `IdentityResolverError` variants |
| ☐ | Production `EventStoreContract` adapter passes `runEventStoreConformanceSuite` (13 tests · no skips) |
| ☐ | Production `RewardPort` passes `runRewardPortConformanceSuite` (5 tests · no skips) |
| ☐ | Production `KeyProviderPort` implements rotation tri-state (active/grace/revoked) |
| ☐ | Production `AuthReplayStore` backed by Redis SETEX or equivalent atomic primitive |
| ☐ | MCP gateway validates manifest at boot via `validateMCPManifest` |
| ☐ | Raffle config declares explicit tier per `classifyRaffleTier` (no implicit TIER-1 above threshold) |
| ☐ | Cross-runtime parity: golden vectors re-derived in your runtime produce byte-identical output |
| ☐ | World-defined `ActivityKind` extensions (if any) follow the `<world>:<kind>` naming + payload size bounds |

---

## Reference

- `INTENT.md` — what the substrate IS / IS NOT
- `EXTRACTION-MAP.md` — per-package source-of-record citations
- `ACVP-MATRIX.md` — the 7-component matrix (sprint-3 T3.4)
- `CMP-CONVENTION.md` — substrate-name vs chat-medium-name discipline (sprint-3 T3.5)
- `VERSIONING.md` — schema_version + breaking-change SLA (sprint-3 T3.11b)
- `grimoires/loa/sdd.md` §6 — security design (auth + cursor + rate-limit)
- `grimoires/loa/sdd.md` §10 — adapter conformance contract
- Adoption case study: cubquests-as-module migration (cycle-Q resume · post-sprint-3)
- Sister composition pattern: `[[closed-loop-reward-mechanic]]` (questponzi-as-substrate)
