/**
 * @0xhoneyjar/quests-discord-renderer — Discord interaction descriptor emitter.
 *
 * Per Cycle Q SDD §5 + PRD D1:
 *   - Dispatches slash · button · modal · embed · thread descriptors
 *   - Emits APIInteractionResponse descriptors only
 *   - Does NOT depend on discord.js (A1 architect lock)
 *   - Does NOT call the Discord API (the consumer bot owns dispatch)
 *
 * Sprint 1 SCAFFOLD landed the 5 dispatch signatures with placeholder
 * descriptors. Sprint 3 BOT WIRING (this commit) lands:
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
import { QuestStatePort } from "@0xhoneyjar/quests-engine";
import type { PlayerIdentity } from "@0xhoneyjar/quests-protocol";
import { handleButton } from "./button-handler.js";
import { handleModalSubmit } from "./modal-handler.js";
import {
  handleSlashCommand,
  type EngineConfigShape,
  type QuestCatalog,
} from "./slash-command-handler.js";
import type {
  CharacterRegistry,
  CuratorVoiceProfile,
} from "./cmp-boundary/transforms.js";
import {
  type APIInteraction,
  type APIInteractionResponse,
  type APIMessageComponentInteraction,
  type APIModalSubmitInteraction,
  InteractionResponseType,
  InteractionType,
  MessageFlags,
} from "./types.js";

const isChatInputCommand = (
  interaction: APIApplicationCommandInteraction,
): interaction is APIChatInputApplicationCommandInteraction =>
  interaction.data.type === ApplicationCommandType.ChatInput;

/**
 * Per-dispatch context the bot consumer constructs before invoking
 * `dispatchQuestInteraction`. Each field is per-guild + per-invocation.
 *
 * The bot consumer:
 *   1. resolves the world from `interaction.guild_id` via world-resolver
 *   2. builds `EngineConfigShape` from world-manifest's quest_engine_config
 *   3. resolves `player` from interaction.member.user (anon-default per D4)
 *   4. provides QuestStatePort Layer per-world (postgres adapter for prod)
 */
export interface DispatchInput {
  readonly interaction: APIInteraction;
  readonly config: EngineConfigShape;
  readonly catalog: QuestCatalog;
  readonly characters: CharacterRegistry;
  readonly voice: CuratorVoiceProfile;
  readonly player: PlayerIdentity;
}

/**
 * Single dispatch entry-point for ALL quest_* interactions (per SDD §5.2).
 *
 * Returns a Discord interaction response descriptor (deferred ACK + later
 * follow-up via webhook · NOT a direct Discord API call).
 *
 * Routing:
 *   slash command "quest" → slash-command-handler.ts
 *   button custom_id "quest_accept_<id>" → button-handler.ts (acceptButton)
 *   button custom_id "quest_submit_<id>" → button-handler.ts (opens modal)
 *   button custom_id "quest_skip_<id>"   → button-handler.ts (no-op ack)
 *   modal_submit custom_id "quest_submission_<id>" → modal-handler.ts
 *
 * CMP-boundary discipline: every output runs through cmp-boundary/transforms.ts
 * before serialization. Test-guarded via cmp-boundary.test.ts.
 *
 * Dependencies (per Effect Context · provided by the bot consumer):
 *   - QuestStatePort (per-world · memory for dev · postgres for prod)
 */
export const dispatchQuestInteraction = (
  input: DispatchInput,
): Effect.Effect<APIInteractionResponse, never, QuestStatePort> => {
  switch (input.interaction.type) {
    case InteractionType.ApplicationCommand:
      if (!isChatInputCommand(input.interaction)) {
        return Effect.succeed({
          type: InteractionResponseType.ChannelMessageWithSource,
          data: {
            content: "the wind is silent · unsupported command kind",
            flags: MessageFlags.Ephemeral,
          },
        } satisfies APIInteractionResponse);
      }
      return handleSlashCommand({
        interaction: input.interaction,
        config: input.config,
        catalog: input.catalog,
        characters: input.characters,
        voice: input.voice,
        player: input.player,
      });
    case InteractionType.MessageComponent:
      return handleButton({
        interaction: input.interaction as APIMessageComponentInteraction,
        config: input.config,
        catalog: input.catalog,
        characters: input.characters,
        voice: input.voice,
        player: input.player,
      });
    case InteractionType.ModalSubmit:
      return handleModalSubmit({
        interaction: input.interaction as APIModalSubmitInteraction,
        config: input.config,
        catalog: input.catalog,
        characters: input.characters,
        voice: input.voice,
        player: input.player,
      });
    default:
      return Effect.succeed({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: {
          content: "unsupported interaction type",
          flags: MessageFlags.Ephemeral,
        },
      } satisfies APIInteractionResponse);
  }
};

export { handleSlashCommand } from "./slash-command-handler.js";
export type {
  SlashCommandInput,
  EngineConfigShape,
  QuestCatalog,
} from "./slash-command-handler.js";
export { handleButton } from "./button-handler.js";
export type { ButtonInput } from "./button-handler.js";
export { handleModalSubmit } from "./modal-handler.js";
export type { ModalInput } from "./modal-handler.js";
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
export {
  renderQuestList,
} from "./cmp-boundary/render-quest-list.js";
export {
  renderQuestDetail,
  type QuestDetailRender,
} from "./cmp-boundary/render-quest-detail.js";
export { renderVerdict } from "./cmp-boundary/render-verdict.js";
export { renderBadgeReveal } from "./cmp-boundary/render-badge-reveal.js";
export {
  transforms,
  questIdToTitle,
  npcIdToDisplayName,
  walletToHandle,
  phaseToNarrative,
  verdictToNarrative,
  badgeUriToVariant,
  filterTelemetryFromOutput,
  type CharacterRegistry,
  type CuratorVoiceProfile,
  type AuthCheck,
  type ConsumerConstraint,
} from "./cmp-boundary/transforms.js";
export type {
  APIInteraction,
  APIInteractionResponse,
  EngineConfigStub,
} from "./types.js";
