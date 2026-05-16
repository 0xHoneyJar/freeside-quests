# VERSIONING — schema_version + breaking-change SLA

> This doc closes **IMP-012** (sprint plan §12.5 DISPUTED accepted): the schema_version
> policy + breaking-change SLA + `WorldDefined` → builtin promotion mechanics.
>
> Companion to `docs/INTEGRATION-PATH.md` (world adoption) + `docs/ACVP-MATRIX.md`
> (the 7-component reference).

---

## Core rule · enum-locked schema_version + new $id on breaking changes

Every event type + every Activity-side struct pins `schema_version: Schema.Literal("1.0.0")` at the schema level. **The literal is the contract.** When the contract changes:

- **PATCH bump (1.0.0 → 1.0.1)** — IMPOSSIBLE for sealed schemas · we don't ship patch-level schema changes (they're either no-ops or additive-minor)
- **MINOR bump (1.0.0 → 1.1.0)** — additive only · new optional fields · new sealed-union variants (built-in promotion) · existing decodes remain valid
- **MAJOR bump (1.0.0 → 2.0.0)** — breaking · requires new file · new `$id` URL · migration plan · old version REMAINS for at least one cycle

**The substrate enforces the literal.** A producer emitting `schema_version: "1.0.1"` against a `Schema.Literal("1.0.0")` schema gets `SchemaValidation` at decode time. By design — drift surfaces immediately at the wire boundary.

---

## What counts as a breaking change

### Breaking (MAJOR · new $id required)

- **Removing a field** from any sealed schema
- **Renaming a field** (semantic identity changes even if shape doesn't)
- **Changing a field's type** (e.g., `Schema.String` → `Schema.Number`)
- **Tightening a constraint** that rejects previously-valid inputs (e.g., `maxLength(64)` → `maxLength(32)` if 33+ char values exist in production)
- **Removing a sealed-union variant** (e.g., dropping `VerificationManualCurator` from `VerificationMethod`)
- **Renaming a sealed-union `_tag` discriminant**
- **Changing JCS canonicalization rules** (would break hash identity · would invalidate every golden vector)

### Non-breaking (MINOR · same $id may stay)

- **Adding an optional field** (decodes of old payloads still succeed because the field is optional)
- **Adding a new sealed-union variant** that didn't exist before (existing payloads still decode; new producers can opt-in)
- **Loosening a constraint** that rejects fewer inputs (e.g., `maxLength(32)` → `maxLength(64)`)
- **Adding a new branded type** (ATTRC: doesn't change existing schema decode paths)
- **Adding a new event type** (no impact on existing event types)

### Subtle cases (require careful judgment)

| Case | Verdict |
|---|---|
| Adding a `Schema.Literal("1.0.1")` schema_version while keeping `"1.0.0"` valid | NOT breaking — but you've created two valid `schema_version` values; document the deprecation timeline for 1.0.0 |
| Tightening a regex pattern that previously matched broader inputs | BREAKING if any production payload existed under the looser pattern; non-breaking if only stricter inputs ever shipped |
| Adding a required field with a `Schema.optional` wrapper but with a default in the producer | NOT breaking at decode time · ALWAYS document the producer's required-field expectation for downstream consumers |
| Refactoring `Schema.Struct → Schema.TaggedStruct` for a previously-untagged shape | BREAKING — the `_tag` field is new and required; old payloads can't decode |

---

## How to ship a breaking change

When MAJOR is required:

1. **Author the new schema in a new file.** E.g., `packages/protocol/src/activity/Activity.v2.0.0.ts`. Do NOT mutate `Activity.ts` in place.

2. **Pin the new `$id`.** `https://schemas.freeside.thj/activity/v2.0.0` — the version is in the path; the substrate routes decodes by `$id` match.

3. **Keep the old schema exported for at least one full cycle.** Both schemas live side-by-side. Old payloads decode via old schema; new payloads decode via new schema.

4. **Update `index.ts` to export both.** Consumers explicitly pick (`import { Activity_v1, Activity_v2 } from "@0xhoneyjar/quests-protocol"`).

5. **Author a migration plan in the SDD amendment for the cycle that ships the bump.** Worlds need to know:
   - When the old schema sunsets (target cycle)
   - How to convert v1 payloads to v2 (per-field mapping)
   - Whether the change is wire-level (event_id changes — golden vectors get re-locked) or just shape-level

6. **Re-derive the golden vectors for any affected event types.** If `Activity` shape changed, the canonical preimage changed, the `event_id` changed — every golden vector for events that carry Activity fields must be re-locked.

7. **Sprint exit criteria for the breaking-change cycle** MUST include:
   - [ ] Old schema still decodes (regression test)
   - [ ] New schema decodes (positive test)
   - [ ] Migration helper function shipped (`convertActivityV1ToV2(v1: ActivityV1): ActivityV2`)
   - [ ] All consuming packages updated to the new schema
   - [ ] Golden vectors re-locked + cross-runtime conformance re-verified

---

## ActivityKind promotion · WorldDefined → builtin

`ActivityKind` is the sealed union of built-in kinds + the `WorldDefined` extension seam. The substrate ships **four** built-in kinds: `quest` · `mission` · `badge-claim` · `raffle-entry`.

### When a `WorldDefined` kind earns built-in promotion

A world-defined kind (`<world>:<kind>` shape, per `WorldDefinedKindId` brand) earns substrate-level promotion when:

1. **Multiple worlds adopt the same shape independently.** Two or more freeside worlds independently arrive at a kind with the same semantic ("partner-bounty" · "stake-delegation" · "memo-attestation"). Cross-world convergence is the strongest signal that the kind belongs in the substrate.

2. **The shape has been stable for one full cycle.** No field changes · no semantic shifts · no scope wobble · across at least 8 weeks of production use in at least one world.

3. **The verification surface is generalizable.** If the world-defined kind only verifies via a world-proprietary mechanism, it doesn't promote. Built-ins must be useful across worlds; if `VerificationMethod` requires a new variant, that variant must be world-agnostic.

4. **The reward shape doesn't require new substrate fields.** If the world-defined kind only works with a custom reward variant, both have to be world-defined. Substrate-level promotion is all-or-nothing per kind.

### Promotion process (advisory · operator-paced)

1. **A world files an RFC** in `0xHoneyJar/freeside-activities/discussions` proposing the promotion. The RFC names:
   - The world-defined kind being proposed (`<world>:<kind>` form)
   - The semantic the kind models (what real-world participation it captures)
   - Evidence of cross-world demand (links to RFCs or `compose_with` declarations from other worlds)
   - Proposed built-in name (kebab-case · no namespace prefix)
   - Shape of the new `ActivityKind` variant (TaggedStruct definition)

2. **Operator review** (`/architect` cycle if accepted). The operator weighs:
   - Cross-world signal strength
   - Substrate scope creep risk (the substrate should stay narrow; built-in kinds are scarce by design)
   - Hash-determinism impact (new `_tag` literal → new canonical preimage for the kind discriminant)

3. **If approved**: the new kind ships in a MINOR schema bump (additive to the sealed union). World-defined uses of the same kind continue to work; world can migrate to the built-in at their pace.

4. **If rejected**: the kind stays world-defined indefinitely. The substrate doesn't have an opinion about world-defined kinds — they exist forever in `WorldDefined` slot as long as the world uses them.

### Sunset of world-defined kinds (after promotion)

When a world-defined kind earns built-in promotion, the world has **one full cycle (8+ weeks)** to migrate from the world-defined form to the built-in form. During the migration window:

- Both forms decode (the world-defined kind continues to validate)
- Events emitted under the world-defined form remain hash-stable (their `event_id` doesn't change)
- Events emitted under the new built-in form get the new `_tag` literal → different canonical preimage → different `event_id`

After the migration window: the world MAY drop the world-defined form (the substrate doesn't enforce this · world autonomy). If the world keeps emitting both, the substrate accepts both — it's a world-scope housekeeping concern.

---

## Reserved prefixes (substrate-enforced)

These prefixes are reserved at substrate level — the schema rejects `WorldDefinedKindId` values starting with them:

| Prefix | Reserved for |
|---|---|
| `freeside-` | freeside-* module-family substrate kinds (the substrate itself ships these) |
| `loa-` | loa framework kinds (cross-cycle infrastructure · not freeside-* world content) |
| `core-` | substrate-internal kinds (not world-facing) |

A world attempting to register `freeside-summer-quest` or `loa-cycle-marker` or `core-test` as a WorldDefined kind gets `SchemaValidation` at decode time. The reservation list is exported as `RESERVED_KIND_PREFIXES` from `packages/protocol/src/activity/ActivityKind.ts` so worlds can pre-validate their kind IDs before submission.

---

## Version compatibility matrix

| schema_version | Status | Consumers should accept | Producers should emit |
|---|---|---|---|
| `1.0.0` | Current · sprint-1/2/3 ship under this | YES (all schemas) | YES |
| (no other versions exist as of 2026-05-16) | | | |

When a v2.0.0 schema ships, this table gets a new row + a deprecation timeline column.

---

## Producer responsibilities

When emitting events / structs against this substrate, producers MUST:

1. Pin the `schema_version` literal to the value the schema declares
2. Pin the `$id` literal to the canonical schema URL
3. Compute `event_id` via the substrate's `computeEventId` (NOT a bare `crypto.subtle.digest`)
4. Supply a caller-controlled `nonce` for mutating events (Fix-A1)
5. NOT add fields outside the schema (the substrate's loose-struct decode silently drops them, but downstream cross-runtime ports may reject)

## Consumer responsibilities

When decoding events / structs from this substrate, consumers MUST:

1. Route decodes by `$id` literal (not by structural shape · the $id is the contract identifier)
2. Re-verify `event_id = SHA-256(canonical preimage)` if the event arrived from an untrusted source (defense in depth)
3. Surface `SchemaValidation` errors to operators (don't silently drop drift)
4. NOT assume field-presence guarantees that the schema marks optional

---

## How to consume golden vectors for cross-runtime parity

Every event type ships 3 golden vectors at `packages/protocol/src/golden-vectors/`. Each vector is a (input, expected_event_id, expected_canonical_jcs) tuple. Decimal edges are covered per IMP-013 (RewardPending 1-wei · 256-bit-max · RewardFailed negative-via-DecimalValue).

A cross-runtime port (Rust · Python · Go) MUST:

1. Implement the same event schemas in the target runtime
2. Run all 21 golden vectors through its `compute_event_id` equivalent
3. Assert byte-identity of `expected_event_id` and `expected_canonical_jcs`

If the runtime produces drift, the runtime is broken — the substrate is the source of truth. The 21-vector suite is the cross-runtime parity gate.

---

## Reference

- `docs/INTENT.md` — what the substrate IS (and what it isn't)
- `docs/ACVP-MATRIX.md` § Component 3 (Schemas) — which schemas the substrate ships
- `packages/protocol/src/encoding/jcs.ts` — RFC 8785 JCS canonicalization (the one third-party call site)
- `packages/protocol/src/golden-vectors/` — 21 cross-runtime parity fixtures
- `packages/protocol/src/activity/ActivityKind.ts` — `RESERVED_KIND_PREFIXES` export
- SDD §5.5 — idempotency_key separate from nonce (D18 resolution)
- SDD §9 — ActivityKind extension governance (D19 RESOLVED)
- SDD §12.3 — backward-compatibility policy (this doc operationalizes that section)
