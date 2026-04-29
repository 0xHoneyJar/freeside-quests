# packages/engine — headless quest logic

The core quest engine library. Stateful where needed; framework-agnostic. What `cubquests-dashboard/actions/*` becomes when the operator-dashboard chrome is stripped from the engine logic.

## Status: scaffolded; content extraction pending

Source: `world-sprawl/cubquests-dashboard/actions/` + `world-sprawl/cubquests/apps/frontend/lib/`. Per `../../docs/EXTRACTION-MAP.md`.

## Planned contents (post-extraction)

| file | purpose |
|---|---|
| `publish.ts` | Quest publishing flow (validate, persist via injected port, emit completion event). Logic only; DB binding is swappable. |
| `queries.ts` | Cached quest queries; cache layer parameterized. |
| `loader.ts` | Quest discovery + filtering logic. |
| `generators.ts` | Quest authoring helpers (generate-input + generate-json + diff utilities). |
| `diff.ts` | Quest-version diff utility (find-json-differences). |
| `claim/` | Consumer-side claim flow (validate completion, mint badge, emit event). Currently inline in cubquests' apps/frontend/lib/. |
| `index.ts` | Public exports |

## Why "headless"

The engine has logic that operates on schemas + ports. It does NOT:
- Render UI (that's `packages/ui/`)
- Talk directly to a specific DB (that's adapter-injected)
- Know about Next.js / SvelteKit / framework specifics
- Own the partner integrations (those stay in CubQuests)

This makes the engine reusable: any app (Purupuru, Honey Port, Mibera, future) can install + wire up the engine to its own UI + DB + chain integrations.

## Composition

- Imports types + schemas from `../protocol/`
- Implements ports declared in `../ports/`
- Doesn't import `../ui/` (rendering is downstream)
- Doesn't import `../adapters/` (adapters compose with the engine; engine doesn't depend on transport)

## Consumers

- `world-sprawl/cubquests-dashboard/` — post-extraction, dashboard wires its actions to call engine functions instead of inline logic
- `world-sprawl/cubquests/apps/frontend/` — claim flows wire to `engine/claim/`
- Future world apps (Purupuru Year 2, Honey Port) — install + wire up the engine
- Server-rendered surfaces that want quest data without a roundtrip
