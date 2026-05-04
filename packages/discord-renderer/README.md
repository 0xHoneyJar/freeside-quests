# `@freeside-quests/discord-renderer` — Discord interaction descriptor emitter

Discord-component descriptor emitter for quest interactions. Cross-bot installable per `[[freeside-modules-as-installables]]`.

> **Cycle Q P1 SCAFFOLD (2026-05-04)** — skeleton ships 5 dispatch function signatures returning placeholder descriptors. Implementation lands in Sprint 3 (P3 BOT WIRING).

## Architectural Lock A1: descriptor emitter, NOT dispatcher

This package emits `APIInteractionResponse` descriptors. It does NOT call the Discord API. It does NOT depend on `discord.js`.

| Layer | Owns | Lives in |
|---|---|---|
| **Descriptor emit** | Build `APIInteractionResponse` shapes | THIS package |
| **Discord dispatch** | Send descriptors to Discord HTTP/Gateway | The consumer bot (`freeside-characters/apps/bot`) |

**Why the split**: Cross-bot installability. Any bot (Discord-attached, future Slack, future Matrix) can compose this package by adopting the descriptor shape. Locking us to `discord.js` would lose that.

**Allowed dependency**: `discord-api-types` (types ONLY, no runtime).
**Forbidden dependency**: `discord.js` (or any runtime Discord client). The component-isolation guard test enforces this.

## Public surface

### Sprint 1 (current · scaffold)

`dispatchQuestInteraction` ships a no-requirement Effect that routes by `InteractionType` and returns a placeholder ephemeral descriptor. No layer-providing is needed yet — the dispatch has `never` requirements.

```typescript
import { Effect } from "effect";
import { dispatchQuestInteraction } from "@freeside-quests/discord-renderer";

// Sprint 1: signature is Effect.Effect<APIInteractionResponse, never, never>
const response = await Effect.runPromise(
  dispatchQuestInteraction({
    interaction,
    config: engineConfigForCurrentWorld(), // EngineConfigStub for Sprint 1
  }),
);
```

### Sprint 3 (forward-pointing · post-QuestStatePort)

Once Sprint 2 lands `QuestStatePort` and Sprint 3 wires it in, the dispatch signature widens to require the port — at which point the consumer provides a layer:

```typescript
import { Effect, Layer } from "effect";
import { dispatchQuestInteraction } from "@freeside-quests/discord-renderer";
import {
  QuestStatePortPostgresLayer,
  AuthCheckPortAnonLayer,
  BadgeIssuancePortNullLayer,
} from "@freeside-quests/engine"; // Sprint 2+

// Sprint 3: signature becomes Effect.Effect<APIInteractionResponse, never, QuestStatePort>
const response = await dispatchQuestInteraction({
  interaction,
  config: engineConfigForCurrentWorld(),
}).pipe(
  Effect.provide(
    Layer.mergeAll(
      QuestStatePortPostgresLayer({ pool_config: pgConfig, world_slug }),
      AuthCheckPortAnonLayer,
      BadgeIssuancePortNullLayer,
    ),
  ),
  Effect.runPromise,
);
```

Sprint 1 ships placeholder descriptors that route correctly but return a stub response. Sprint 3 lands the full CMP-boundary transforms + dispatch routing.

## CMP-boundary discipline

Per `[[chat-medium-presentation-boundary]]` §2 drift signature:

- ❌ NEVER let raw `quest_uuid`, `npc_id`, `wallet`, `trace_id`, or `submission_id` escape into Discord output
- ✅ ALWAYS apply `cmp-boundary/transforms.ts` before serialization
- ✅ Test guarded by `__tests__/cmp-boundary.test.ts` regression suite (Sprint 3)

The 7 transforms are documented in SDD §5.3.

## Mention + thread surface (D7-default)

Per `[[explicit-invocation-anti-spam]]`:
- `@<character> <message>` triggers `thread-spawner`
- All quest interactions scoped to that thread
- Character NEVER posts unsolicited

## Doctrine references

- `[[chat-medium-presentation-boundary]]` — CMP transforms applied at serialization boundary
- `[[freeside-modules-as-installables]]` — sealed schemas + typed ports + cross-bot installable
- `[[explicit-invocation-anti-spam]]` — mention+thread default
- Cycle Q SDD §5 — full descriptor emitter spec
- Cycle Q PRD D1 — discord-renderer location (NEW sub-package vs. inline-in-bot)
