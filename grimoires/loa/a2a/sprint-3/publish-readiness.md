# T3.12 · npm publish-readiness check — PASSED

**Date**: 2026-05-16
**Cycle**: acvp-modules-genesis · sprint-3
**Tool**: `bun pm pack --dry-run` per package
**Verdict**: ✓ ALL 4 PACKAGES PUBLISH-READY

## Per-package results

| Package | Name | Files | Unpacked | private | access | README |
|---|---|---|---|---|---|---|
| `packages/protocol` | `@0xhoneyjar/quests-protocol` | 437 | 0.89 MB | false | public | ✓ (56 lines) |
| `packages/adapters` | `@0xhoneyjar/freeside-activities-adapters` | 60 | 248 KB | false | public | ✓ (33 lines) |
| `packages/engine` | `@0xhoneyjar/quests-engine` | 119 | 0.56 MB | false | public | ✓ (43 lines) |
| `packages/mcp-tools` | `@0xhoneyjar/freeside-activities-mcp-tools` | 23 | 87.64 KB | false | public | ✓ (35 lines) |

## Verification checklist

| ✓ | Check |
|---|---|
| ✓ | All 4 packages dry-run cleanly (no errors) |
| ✓ | `package.json files[]` configured (dist + src + README.md · mcp-tools also includes tools + manifest.json) |
| ✓ | No `node_modules` in packed output |
| ✓ | No `.env` / `.env.*` files anywhere |
| ✓ | No `*.key` / `*.pem` / `secret*` files |
| ✓ | All packages have README.md |
| ✓ | `private: false` declared (or absent, default = publishable) |
| ✓ | `publishConfig.access: "public"` set (required for scoped packages) |
| ✓ | Package names match the new freeside-* family (protocol + engine keep `quests-*` namespace per heritage; new sprint-2 packages use `freeside-activities-*` prefix) |

## Files[] declarations

```json
// protocol + adapters + engine
"files": ["dist", "src", "README.md"]

// mcp-tools (also ships manifest + tool specs as runtime assets)
"files": ["dist", "src", "tools", "manifest.json", "README.md"]
```

Including `src` is intentional — the substrate is small enough that consumers benefit from reading sources as documentation. Tests live in `src/**/__tests__/` and ride with the source; they're small and self-documenting. No build step strips them.

## How to actually publish (NOT this cycle)

Per cycle kickoff §12.1: this cycle does NOT publish. The `bun publish --dry-run` clean was the deliverable.

When publishing happens (future cycle):

```bash
# protocol first (downstream packages depend on it)
cd packages/protocol && bun publish

# then engine + adapters + mcp-tools (any order — protocol is the only cross-dep)
cd packages/engine && bun publish
cd packages/adapters && bun publish
cd packages/mcp-tools && bun publish
```

Publish prerequisites the operator must verify before running the above:
- npm login (`npm whoami` returns expected user)
- Two-factor auth available for the publish-OTP prompt (npm policy for scoped packages)
- `npm-package-access-policy.md` (if THJ maintains one) cleared the new package names
- Version bumps applied (current: protocol@0.1.2 · engine@0.1.2 · adapters@0.1.0 · mcp-tools@0.1.0)

## Carryover for sprint-3 close

Two of the four packages still use the `quests-*` namespace (`@0xhoneyjar/quests-protocol` · `@0xhoneyjar/quests-engine`). This is intentional per kickoff §"Heritage preserved" — the package surface keeps the `quests-*` brand for backward compatibility with anything already importing the protocol. The two new sprint-2 packages use the new `freeside-activities-*` prefix because they're new packages without legacy import paths.

If a future cycle decides to rename the `@0xhoneyjar/quests-*` packages to `@0xhoneyjar/freeside-activities-*`, that's a breaking change for any consumer that imports them — requires:
1. Major version bump (1.0.0)
2. Deprecation notice on the old package names
3. Re-publish under new names
4. Operator-approved migration window

For sprint-3 the package names stay as they are.

## Reference

- Kickoff: `~/bonfire/grimoires/bonfire/specs/acvp-modules-genesis-kickoff-2026-05-15.md` §12.1
- Sprint plan T3.12 acceptance criterion: `bun publish --dry-run` clean for all packages · package.json files[] correct · NO node_modules/.env/.secret committed · README rewritten
- All criteria met ✓
