/**
 * dispatch-skeleton.test.ts — Sprint 1 SCAFFOLD smoke test.
 *
 * Asserts the 5 dispatch signatures compile and return placeholder descriptors.
 * Sprint 3 BOT WIRING expands to cmp-boundary.test.ts regression suite.
 */

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { buildQuestEmbed } from "../src/embed-builder.js";
import {
  dispatchQuestInteraction,
  type DispatchInput,
} from "../src/index.js";
import { buildThreadSpawnDescriptor } from "../src/thread-spawner.js";
import {
  type APIChatInputApplicationCommandInteraction,
  type APIMessageComponentInteraction,
  type APIModalSubmitInteraction,
  type EngineConfigStub,
  InteractionResponseType,
  InteractionType,
} from "../src/types.js";

const config: EngineConfigStub = {
  questAcceptanceMode: "open-badge-gated",
  worldSlug: "mibera",
  submissionStyle: "inline-thread",
  positiveFrictionDelayMs: 12000,
};

const slashCommand: APIChatInputApplicationCommandInteraction = {
  // Minimal subset — discord-api-types is structural; we only fill what
  // the dispatcher reads (type · data).
  id: "interaction-1",
  application_id: "app-1",
  type: InteractionType.ApplicationCommand,
  token: "token",
  version: 1,
  data: {
    id: "cmd-1",
    name: "quest",
    type: 1,
  },
  app_permissions: "0",
  // biome-ignore lint: structural cast for test
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe("@freeside-quests/discord-renderer SCAFFOLD", () => {
  it("dispatchQuestInteraction routes ApplicationCommand to slash handler", async () => {
    const input: DispatchInput = { interaction: slashCommand, config };
    const result = await Effect.runPromise(dispatchQuestInteraction(input));
    expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
  });

  it("dispatchQuestInteraction routes MessageComponent to button handler", async () => {
    const buttonInteraction = {
      id: "i-2",
      application_id: "app-1",
      type: InteractionType.MessageComponent,
      token: "token",
      version: 1,
      data: {
        custom_id: "quest_accept_q-01",
        component_type: 2,
      },
      app_permissions: "0",
    } as unknown as APIMessageComponentInteraction;
    const result = await Effect.runPromise(
      dispatchQuestInteraction({ interaction: buttonInteraction, config }),
    );
    expect(result.type).toBe(InteractionResponseType.ChannelMessageWithSource);
  });

  it("dispatchQuestInteraction routes ModalSubmit to modal handler", async () => {
    const modalInteraction = {
      id: "i-3",
      application_id: "app-1",
      type: InteractionType.ModalSubmit,
      token: "token",
      version: 1,
      data: {
        custom_id: "quest_submission_q-01",
        components: [],
      },
      app_permissions: "0",
    } as unknown as APIModalSubmitInteraction;
    const result = await Effect.runPromise(
      dispatchQuestInteraction({ interaction: modalInteraction, config }),
    );
    expect(result.type).toBe(
      InteractionResponseType.DeferredChannelMessageWithSource,
    );
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
    const descriptor = await Effect.runPromise(
      buildThreadSpawnDescriptor({
        channel_id: "c-1",
        parent_message_id: "m-1",
        user_id: "u-1",
        mention_text: "@mongolian hello",
        config,
      }),
    );
    expect(descriptor.action).toBe("create-thread");
    expect(descriptor.thread_name).toContain("mibera");
  });
});
