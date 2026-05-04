/**
 * embed-builder.ts — Quest → Embed descriptor emitter.
 *
 * Sprint 1 SCAFFOLD: signature lands · returns minimal embed shape with
 * placeholder body. Sprint 3 BOT WIRING: ≤180-word body guard + CMP transforms.
 *
 * Per SDD §5.4: embed body ≤180 words per [[discord-native-register]].
 */

/** Minimal embed descriptor shape (subset of discord-api-types APIEmbed). */
export interface QuestEmbedDescriptor {
  readonly title: string;
  readonly description: string;
  readonly footer?: { readonly text: string };
  readonly fields?: readonly {
    readonly name: string;
    readonly value: string;
    readonly inline?: boolean;
  }[];
}

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
export const buildQuestEmbed = (
  input: EmbedBuildInput,
): QuestEmbedDescriptor => ({
  title: input.title,
  description: input.body,
});
