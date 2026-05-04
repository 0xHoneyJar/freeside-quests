/**
 * button-handler.ts — button interaction custom_id routing.
 *
 * Sprint 1 SCAFFOLD: signature lands · returns deferred ack.
 * Sprint 3 BOT WIRING: routes by custom_id prefix (`quest_accept_<id>` ·
 * `quest_submit_<id>`) into engine state-machine transitions.
 *
 * Per SDD §5.2: "button custom_id 'quest_accept_<id>' → button-handler.ts".
 */

import { Effect } from "effect";
import {
  type APIInteractionResponse,
  type APIMessageComponentInteraction,
  type EngineConfigStub,
  InteractionResponseType,
  MessageFlags,
} from "./types.js";

export interface ButtonInput {
  readonly interaction: APIMessageComponentInteraction;
  readonly config: EngineConfigStub;
}

/**
 * Handle button-component interaction with quest_* custom_id.
 *
 * Sprint 3 routes:
 *   - "quest_accept_<quest_id>" → state-machine accept · ephemeral confirm
 *   - "quest_submit_<quest_id>" → opens modal (modal-handler responds)
 *   - "quest_skip_<quest_id>" → no-op ack · removes from active set
 */
export const handleButton = (
  input: ButtonInput,
): Effect.Effect<APIInteractionResponse, never, never> =>
  Effect.succeed({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      content: `[scaffold] button ${input.interaction.data.custom_id} in world=${input.config.worldSlug}`,
      flags: MessageFlags.Ephemeral,
    },
  } satisfies APIInteractionResponse);
