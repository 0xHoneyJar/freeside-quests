/**
 * dispatch-skeleton.test.ts — sprint-3 dispatch routing smoke test.
 *
 * Originally Sprint 1 SCAFFOLD; sprint-3 BOT WIRING expanded the dispatch
 * surface to require QuestStatePort + per-guild context (catalog · characters ·
 * voice · player). This test now provides minimal in-memory implementations
 * to assert the routing dispatch still resolves to the right handler kinds.
 *
 * The richer behavioral guarantees live in cmp-boundary.test.ts.
 */

import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  QuestStatePortMemoryLayer,
} from "@freeside-quests/engine";
import type {
  PlayerIdentity,
  Quest,
} from "@freeside-quests/protocol";
import { buildQuestEmbed } from "../src/embed-builder.js";
import {
  dispatchQuestInteraction,
  type DispatchInput,
  type EngineConfigShape,
  type QuestCatalog,
} from "../src/index.js";
import { buildThreadSpawnDescriptor } from "../src/thread-spawner.js";
import type {
  CharacterRegistry,
  CuratorVoiceProfile,
} from "../src/cmp-boundary/transforms.js";
import {
  type APIChatInputApplicationCommandInteraction,
  type APIMessageComponentInteraction,
  type APIModalSubmitInteraction,
  type EngineConfigStub,
  InteractionResponseType,
  InteractionType,
} from "../src/types.js";

const config: EngineConfigShape = {
  questAcceptanceMode: "open-badge-gated",
  worldSlug: "mibera",
  submissionStyle: "modal_form",
  positiveFrictionDelayMs: 12000,
};

const fixtureQuest: Quest = {
  quest_id: "q-test-01" as Quest["quest_id"],
  npc_pointer: "mongolian" as Quest["npc_pointer"],
  world_slug: "mibera" as Quest["world_slug"],
  title: "Test Quest",
  prompt: "the steppe waits.",
  rubric_pointer: { type: "url", url: "https://example.test/rubric" },
  badge_spec: {
    family_id: "test-badge" as Quest["badge_spec"]["family_id"],
    display_name: "Test Mark",
    prompt_seed: "petroglyph",
  },
  published_at: "2026-05-04T12:00:00Z",
  step_count: 1,
  contract_version: "1.0.0",
};

const catalog: QuestCatalog = {
  listAvailableQuests: () => Effect.succeed([fixtureQuest]),
  findQuest: (_world, quest_id) =>
    Effect.succeed(quest_id === fixtureQuest.quest_id ? fixtureQuest : undefined),
};

const characters: CharacterRegistry = {
  resolveDisplayName: (npc_id) => (npc_id === "mongolian" ? "Munkh" : undefined),
};

const voice: CuratorVoiceProfile = {
  accepted: "your mark joins the fire",
};

const player: PlayerIdentity = {
  type: "anon",
  discord_id: "111111111111111111" as PlayerIdentity["discord_id"],
};

const slashCommand: APIChatInputApplicationCommandInteraction = {
  id: "interaction-1",
  application_id: "app-1",
  type: InteractionType.ApplicationCommand,
  token: "token",
  version: 1,
  data: {
    id: "cmd-1",
    name: "quest",
    type: 1,
    options: [{ name: "browse", type: 1 }],
  },
  app_permissions: "0",
  // biome-ignore lint: structural cast for test
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const buildInput = (
  interaction:
    | APIChatInputApplicationCommandInteraction
    | APIMessageComponentInteraction
    | APIModalSubmitInteraction,
): DispatchInput => ({
  interaction,
  config,
  catalog,
  characters,
  voice,
  player,
});

const runWithMemoryLayer = <A>(
  effect: Effect.Effect<A, never, ReturnType<typeof QuestStatePortMemoryLayer>["_R"]>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(QuestStatePortMemoryLayer)));

describe("@freeside-quests/discord-renderer · sprint-3 dispatch routing", () => {
  it("routes ApplicationCommand /quest browse to slash handler", async () => {
    const result = await runWithMemoryLayer(
      dispatchQuestInteraction(buildInput(slashCommand)),
    );
    expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
  });

  it("routes MessageComponent quest_accept_<id> button to button handler", async () => {
    const buttonInteraction = {
      id: "i-2",
      application_id: "app-1",
      type: InteractionType.MessageComponent,
      token: "token",
      version: 1,
      data: {
        custom_id: `quest_accept_${fixtureQuest.quest_id}`,
        component_type: 2,
      },
      app_permissions: "0",
    } as unknown as APIMessageComponentInteraction;
    const result = await runWithMemoryLayer(
      dispatchQuestInteraction(buildInput(buttonInteraction)),
    );
    expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
  });

  it("routes MessageComponent quest_submit_<id> button to modal-open response", async () => {
    const buttonInteraction = {
      id: "i-3",
      application_id: "app-1",
      type: InteractionType.MessageComponent,
      token: "token",
      version: 1,
      data: {
        custom_id: `quest_submit_${fixtureQuest.quest_id}`,
        component_type: 2,
      },
      app_permissions: "0",
    } as unknown as APIMessageComponentInteraction;
    const result = await runWithMemoryLayer(
      dispatchQuestInteraction(buildInput(buttonInteraction)),
    );
    expect(result.type).toBe(InteractionResponseType.Modal);
  });

  it("routes ModalSubmit to modal handler · returns ChannelMessage with cadence", async () => {
    const modalInteraction = {
      id: "i-4",
      application_id: "app-1",
      type: InteractionType.ModalSubmit,
      token: "token",
      version: 1,
      data: {
        custom_id: `quest_submission_${fixtureQuest.quest_id}`,
        components: [
          {
            type: 1, // ActionRow
            components: [
              {
                type: 4, // TextInput
                custom_id: "approach",
                value: "fire",
              },
            ],
          },
          {
            type: 1, // ActionRow
            components: [
              {
                type: 4, // TextInput
                custom_id: "response",
                value: "I bring the warmth of the camp.",
              },
            ],
          },
        ],
      },
      app_permissions: "0",
    } as unknown as APIModalSubmitInteraction;
    const result = await runWithMemoryLayer(
      dispatchQuestInteraction(buildInput(modalInteraction)),
    );
    expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
  });

  it("buildQuestEmbed returns descriptor with title + description", () => {
    const embed = buildQuestEmbed({
      title: "Hello, steppe.",
      body: "Mark the fire.",
    });
    expect(embed.title).toBe("Hello, steppe.");
    expect(embed.description).toBe("Mark the fire.");
  });

  it("buildThreadSpawnDescriptor returns create-thread action", async () => {
    const stub: EngineConfigStub = {
      questAcceptanceMode: "open-badge-gated",
      worldSlug: "mibera",
      submissionStyle: "inline-thread",
      positiveFrictionDelayMs: 12000,
    };
    const descriptor = await Effect.runPromise(
      buildThreadSpawnDescriptor({
        channel_id: "c-1",
        parent_message_id: "m-1",
        user_id: "u-1",
        mention_text: "@mongolian hello",
        config: stub,
      }),
    );
    expect(descriptor.action).toBe("create-thread");
    expect(descriptor.thread_name).toContain("mibera");
  });
});
