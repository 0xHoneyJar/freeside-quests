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
 * descriptors. Sprint 3 BOT WIRING landed the full state-machine.
 *
 * Cycle R Sprint 3 (this commit) adds @0xhoneyjar/medium-registry
 * consumption — DISCORD_INTERACTION_DESCRIPTOR is the typed source-of-truth
 * for the interactive surface this package emits.
 *
 * The architectural rationale (SKP-001 fix in v0.2.0):
 *   discord-renderer ALWAYS operates in interaction context — slash
 *   commands, button presses, modal submits all carry interaction tokens.
 *   Modal + ephemeral capabilities are interaction-only; using
 *   DISCORD_INTERACTION_DESCRIPTOR makes that contract explicit.
 *   Persona-bots delivering via webhook (ruggy/satoshi/munkh in
 *   freeside-characters) use DISCORD_WEBHOOK_DESCRIPTOR — distinct.
 */

import { Effect } from "effect";
import type {
  APIApplicationCommandInteraction,
  APIChatInputApplicationCommandInteraction,
} from "discord-api-types/v10";
import { ApplicationCommandType } from "discord-api-types/v10";
import { QuestStatePort } from "@0xhoneyjar/quests-engine";
import type { PlayerIdentity } from "@0xhoneyjar/quests-protocol";
import {
  DISCORD_INTERACTION_DESCRIPTOR,
  hasCapability,
  type MediumCapability,
} from "@0xhoneyjar/medium-registry";
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
 * The medium descriptor this renderer operates against.
 *
 * Per cycle R Sprint 3: discord-renderer always operates in interaction
 * context (slash + button + modal flows). This export lets bot consumers
 * inspect the capability shape and lets cross-repo audit tests verify
 * that every capability key the renderer consumes exists.
 *
 * Use `medium` in `hasCapability(medium, KEY)` calls when conditional
 * capability branches are added. Today the renderer hardcodes the
 * interaction-context capabilities (modal, ephemeral, slash); the medium
 * is exposed for future extension + audit.
 */
export const medium: MediumCapability = DISCORD_INTERACTION_DESCRIPTOR;

/**
 * Capability assertion — verifies the registry shape matches what this
 * package relies on. Catches a registry version mismatch at module-load
 * time rather than at first interaction.
 *
 * If this throws, the operator has installed an incompatible
 * medium-registry version. Pin `^0.2.0`.
 */
const REQUIRED_CAPABILITIES = [
  "text",
  "embed",
  "attachment",
  "customEmoji",
  "sticker",
  "slashCommand",
  "modal",
  "button",
  "ephemeral",
  "mention",
  "thread",
] as const;
for (const cap of REQUIRED_CAPABILITIES) {
  if (!hasCapability(medium, cap)) {
    throw new Error(
      `discord-renderer requires DISCORD_INTERACTION_DESCRIPTOR.${cap}=true · check @0xhoneyjar/medium-registry version`,
    );
  }
}

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

// ---------------------------------------------------------------------------
// medium-registry re-exports (cycle R sprint 3)
// ---------------------------------------------------------------------------

/**
 * Cycle R Sprint 3 — re-export the interaction descriptor + accessor for
 * downstream consumers that want to inspect capabilities without adding
 * @0xhoneyjar/medium-registry as a direct dep.
 *
 * Use:
 *   import { medium, hasCapability } from '@0xhoneyjar/quests-discord-renderer';
 *   if (hasCapability(medium, 'modal')) { ... }
 */
export { hasCapability, type MediumCapability } from "@0xhoneyjar/medium-registry";
export { DISCORD_INTERACTION_DESCRIPTOR } from "@0xhoneyjar/medium-registry";
