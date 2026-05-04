# `@freeside-quests/ui` — unstyled React primitives

5 slot-based React primitives for quest UIs. Shape, not chrome — every consumer (cubquests-dashboard, per-world bots, future Farcaster Mini App) ships its own skin atop these primitives.

> **Cycle Q P1 SCAFFOLD (2026-05-04)** — primitives compile cleanly, zero CSS shipped, zero design tokens. Per Cycle Q SDD §6 + PRD D2.

## Anti-pattern guard: NEVER ship a default skin

This package ships SHAPE not CHROME. If you find yourself wanting to add a default Tailwind class, a CSS module, a `style={...}` block, or a "starter theme" — STOP. Each consumer (cubquests-dashboard, per-world bots, future Farcaster Mini App) ships its own skin. A "default skin" becomes the only one used in practice, breaks the unstyled contract, and locks visual register at the wrong layer.

Per `[[freeside-modules-as-installables]]` §"What goes into a module's `packages/protocol/`": presentation chrome belongs at the consumer; primitives belong in the module.

**Test guard**: `__tests__/component-isolation.test.tsx` greps the package source for any `.css` import or `style=` attribute and FAILS the build if found.

## Components (slot-based composition)

| Component | Purpose | Slot pattern |
|---|---|---|
| `<QuestCard>` | Compact quest representation | `Title` · `Description` · `Reward` · `Actions` slots |
| `<QuestDetailEmbed>` | Single-quest detail view | `Header` · `Body` · `Footer` · `Actions` slots |
| `<BadgeShowcase>` | Badge artifact rendering · layout-only | `BadgeShowcase.Item` compound pattern |
| `<ProgressTracker>` | QuestState phase visualizer · phase pills | `Phase` slot for per-phase render |
| `<VerdictReveal>` | Curator-narrative reveal · phase-callbacks | `children` + `onPhaseEnter` callbacks |

## Composition examples (illustrative · NOT shipped)

```tsx
// cubquests-dashboard (Tailwind skin)
import { QuestCard } from "@freeside-quests/ui";
<QuestCard
  quest={quest}
  Title={({ quest }) => <h2 className="text-2xl font-bold">{quest.title}</h2>}
  Description={({ quest }) => <p className="text-gray-600">{quest.prompt}</p>}
  Reward={({ badge_spec }) => <BadgeChip name={badge_spec.display_name} />}
  Actions={({ onAccept }) => <button className="btn-primary" onClick={onAccept}>Accept</button>}
/>

// per-world bot (server-side render · zero React runtime)
// uses @freeside-quests/discord-renderer · NOT @freeside-quests/ui · this is the boundary

// future Farcaster Mini App (Vite skin)
import { QuestCard } from "@freeside-quests/ui";
<QuestCard quest={quest} Title={MyTitle} Description={MyDescription} ... />
```

## What's NOT here

- World-specific quest CONTENT renderers (each world's quest detail page is its own app code)
- Operator-facing dashboard chrome (stays in consumer apps)
- Auth wires (each world's Identity Component handles auth)
- Discord rendering (use `@freeside-quests/discord-renderer` — different boundary, different transport)
- CSS / Tailwind / styled-components / design tokens (anti-pattern guard above)

## Consumers (planned · post-Cycle Q)

- `cubquests-dashboard/` — operator surface
- `freeside-characters/apps/character-mongolian/` — per-world bot (uses `discord-renderer` · NOT this pkg)
- Future world apps (Purupuru Year 2, Honey Port, Mibera quest UI) — install + skin

## Doctrine references

- `[[freeside-modules-as-installables]]` — sealed schemas + typed ports + presentation belongs at consumer
- `[[chat-medium-presentation-boundary]]` — discord-renderer is a SIBLING boundary, not this package's concern
- Cycle Q SDD §6 — sealed component contracts + slot pattern
- Cycle Q PRD D2 — anti-pattern guard rationale
