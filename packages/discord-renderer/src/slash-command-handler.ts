/**
 * slash-command-handler.ts — slash dispatch for `/quest browse|accept|submit|status`.
 *
 * Sprint 1 SCAFFOLD: signature lands · returns placeholder ephemeral descriptor.
 * Sprint 3 BOT WIRING: full subcommand routing + CMP transforms applied.
 *
 * Per SDD §5.2 dispatch surface + §5.4 component primitives.
 */

import { Effect } from "effect";
import {
  type APIChatInputApplicationCommandInteraction,
  type APIInteractionResponse,
  type EngineConfigStub,
  InteractionResponseType,
  MessageFlags,
} from "./types.js";

export interface SlashCommandInput {
  readonly interaction: APIChatInputApplicationCommandInteraction;
  readonly config: EngineConfigStub;
}

/**
 * Handle `/quest <subcommand>` slash command interaction.
 *
 * Sprint 3 implements:
 *   - "browse" → render-quest-list (≤5 quests · select_menu for >5)
 *   - "accept" → state-machine accept transition · ephemeral confirm
 *   - "submit" → opens modal (D2 modal-form) OR inline prompt (D2 inline-thread)
 *   - "status" → ephemeral list of user's QuestStates
 */
export const handleSlashCommand = (
  input: SlashCommandInput,
): Effect.Effect<APIInteractionResponse, never, never> =>
  Effect.succeed({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      content: `[scaffold] /quest received in world=${input.config.worldSlug}`,
      flags: MessageFlags.Ephemeral,
    },
  } satisfies APIInteractionResponse);
