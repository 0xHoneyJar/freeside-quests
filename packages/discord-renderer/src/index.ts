/**
 * @freeside-quests/discord-renderer — Discord interaction descriptor emitter.
 *
 * Per Cycle Q SDD §5 + PRD D1:
 *   - 5 dispatch handlers (slash · button · modal · embed · thread)
 *   - Emits APIInteractionResponse descriptors
 *   - Does NOT depend on discord.js (A1 architect lock)
 *   - Does NOT call the Discord API (the consumer bot owns dispatch)
 *
 * Sprint 1 SCAFFOLD ships the 5 dispatch signatures with placeholder
 * descriptors. Sprint 3 BOT WIRING lands:
 *   - CMP-boundary transforms (cmp-boundary/transforms.ts · 7 transforms)
 *   - Full state-machine wiring via QuestStatePort
 *   - render-quest-list / render-quest-detail / render-verdict / render-badge-reveal
 *   - cmp-boundary.test.ts regression suite
 */

import { Effect } from "effect";
import type {
  APIApplicationCommandInteraction,
  APIChatInputApplicationCommandInteraction,
} from "discord-api-types/v10";
import { ApplicationCommandType } from "discord-api-types/v10";
import { handleButton } from "./button-handler.js";
import { handleModalSubmit } from "./modal-handler.js";
import { handleSlashCommand } from "./slash-command-handler.js";
import {
  type APIInteraction,
  type APIInteractionResponse,
  type EngineConfigStub,
  InteractionResponseType,
  InteractionType,
  MessageFlags,
} from "./types.js";

const isChatInputCommand = (
  interaction: APIApplicationCommandInteraction,
): interaction is APIChatInputApplicationCommandInteraction =>
  interaction.data.type === ApplicationCommandType.ChatInput;

export interface DispatchInput {
  readonly interaction: APIInteraction;
  readonly config: EngineConfigStub;
}

/**
 * Single dispatch entry-point for ALL quest_* interactions (per SDD §5.2).
 *
 * Sprint 1 SCAFFOLD: routes by InteractionType + returns placeholder descriptor.
 * Sprint 3 BOT WIRING: full routing + CMP transforms + QuestStatePort dependency.
 *
 * NOTE: Sprint 1 declares this as `Effect.Effect<..., never, never>` (no
 * QuestStatePort dependency yet). Sprint 2 lands QuestStatePort, Sprint 3 wires
 * it in — at which point the signature becomes
 * `Effect.Effect<APIInteractionResponse, never, QuestStatePort>` per SDD §5.2.
 */
export const dispatchQuestInteraction = (
  input: DispatchInput,
): Effect.Effect<APIInteractionResponse, never, never> => {
  switch (input.interaction.type) {
    case InteractionType.ApplicationCommand:
      if (!isChatInputCommand(input.interaction)) {
        return Effect.succeed({
          type: InteractionResponseType.ChannelMessageWithSource,
          data: {
            content: "[scaffold] non-chat-input application command",
            flags: MessageFlags.Ephemeral,
          },
        } satisfies APIInteractionResponse);
      }
      return handleSlashCommand({
        interaction: input.interaction,
        config: input.config,
      });
    case InteractionType.MessageComponent:
      return handleButton({
        interaction: input.interaction,
        config: input.config,
      });
    case InteractionType.ModalSubmit:
      return handleModalSubmit({
        interaction: input.interaction,
        config: input.config,
      });
    default:
      return Effect.succeed({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: {
          content: "[scaffold] unsupported interaction type",
          flags: MessageFlags.Ephemeral,
        },
      } satisfies APIInteractionResponse);
  }
};

export { handleSlashCommand } from "./slash-command-handler.js";
export { handleButton } from "./button-handler.js";
export { handleModalSubmit } from "./modal-handler.js";
export { buildQuestEmbed } from "./embed-builder.js";
export type {
  EmbedBuildInput,
  QuestEmbedDescriptor,
} from "./embed-builder.js";
export { buildThreadSpawnDescriptor } from "./thread-spawner.js";
export type {
  ThreadCreateDescriptor,
  ThreadSpawnInput,
} from "./thread-spawner.js";
export type { SlashCommandInput } from "./slash-command-handler.js";
export type { ButtonInput } from "./button-handler.js";
export type { ModalInput } from "./modal-handler.js";
export type {
  APIInteraction,
  APIInteractionResponse,
  EngineConfigStub,
} from "./types.js";
