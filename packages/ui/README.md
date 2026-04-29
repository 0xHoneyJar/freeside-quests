# packages/ui — shared React components for quest UIs

The visual primitives every world's quest UI starts from. Shape, not chrome — consumers skin via design tokens to match their world's identity.

## Status: scaffolded; content extraction pending

Source: `world-sprawl/cubquests/packages/ui/src/` + select components from `world-sprawl/cubquests-dashboard/components/`. Per `../../docs/EXTRACTION-MAP.md`.

## Planned contents (post-extraction)

| component family | purpose |
|---|---|
| `<QuestCard>` | Compact + expanded quest representation; props for completion state, partner badge, deadline |
| `<BadgeShelf>` | Grid of held badges; props for size, ordering, hover affordance |
| `<CompletionCeremony>` | Reward-reveal animation + receipt; consumes a CompletionEvent |
| `<RaffleEntryButton>` | One-click raffle entry; pending → entered → won states |
| `<ProgressBar>` | Quest progress affordance (count-based, time-based, criteria-based) |
| `<QuestList>` | Filterable/sortable list of quests; built from QuestCard |

## Skinning

Each component accepts:
- `className` overrides for layout
- CSS custom properties for color/typography/spacing (consumers' tokens override the defaults)
- Optional `slots` for full sub-component replacement when a world's design demands it

The default styling is **register-neutral** — calm shadcn-clean baseline (per [[freeside-deceptively-simple-register]]). World-specific identity moments (pixel-art badges, daemon-voice completion lines) compose ABOVE the shape layer.

## What's NOT here

- World-specific quest CONTENT renderers (each world's quest detail page is its own app code)
- Operator-facing dashboard chrome (stays in `cubquests-dashboard/components/`)
- Auth wires (each world's Identity Component handles auth)

## Consumers

- `world-sprawl/cubquests-dashboard/` — post-extraction, replaces `cubquests/packages/ui` consumption with this
- `world-sprawl/cubquests/apps/frontend/` — same; CubQuests' end-user surface skins these components
- Future world apps (Purupuru Year 2 quest UI, Honey Port quest UI, Mibera quest UI) — install + skin
- `freeside-worlds/packages/creator/` Stage 6 (Protocol declaration) — references this package when a world declares quests as part of its scope
