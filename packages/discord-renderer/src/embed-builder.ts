/**
 * embed-builder.ts — Quest → Embed descriptor emitter.
 *
 * Sprint 1 SCAFFOLD: signature lands · returns minimal embed shape with
 * placeholder body. Sprint 3 BOT WIRING: ≤180-word body guard + CMP transforms.
 *
 * Per SDD §5.4: embed body ≤180 words per [[discord-native-register]].
 *
 * Returns the canonical `APIEmbed` shape from `discord-api-types/v10` so the
 * consumer can attach directly to an `APIInteractionResponseChannelMessageWithSource`
 * (no per-emitter translation layer).
 */

import type { APIEmbed } from "discord-api-types/v10";

/**
 * Public alias retained for forward-compatibility — Sprint 3 may extend this
 * with internal-only metadata before the renderer applies CMP transforms.
 *
 * Sprint 1 ships it as a direct alias of `APIEmbed` so consumers can splice
 * the result into `data.embeds = [questEmbed]` without casting.
 */
export type QuestEmbedDescriptor = APIEmbed;

export interface EmbedBuildInput {
  readonly title: string;
  readonly body: string;
}

/**
 * Build a quest detail embed.
 *
 * Sprint 3 enforces ≤180-word body via guard test. Sprint 1 just shapes the
 * descriptor.
 */
export const buildQuestEmbed = (input: EmbedBuildInput): QuestEmbedDescriptor => ({
  title: input.title,
  description: input.body,
});
