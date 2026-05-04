/**
 * modal-handler.ts — modal-submit interaction handler.
 *
 * Sprint 1 SCAFFOLD: signature lands · returns deferred ack.
 * Sprint 3 BOT WIRING: extracts approach + response text inputs · constructs
 * SubmissionEnvelope · invokes engine submit transition.
 *
 * Per SDD §5.4: "Modal (submission form) · 2 text inputs ·
 * 'Approach (1 line)' + 'Response (paragraph)'".
 */

import { Effect } from "effect";
import {
  type APIInteractionResponse,
  type APIModalSubmitInteraction,
  type EngineConfigStub,
  InteractionResponseType,
  MessageFlags,
} from "./types.js";

export interface ModalInput {
  readonly interaction: APIModalSubmitInteraction;
  readonly config: EngineConfigStub;
}

/**
 * Handle modal-submit interaction with quest_submission_<id> custom_id.
 *
 * Sprint 3 extracts the 2 text inputs (approach line + response paragraph),
 * constructs a SubmissionEnvelope per SDD §3.3, and invokes the engine
 * `submit` state-machine transition.
 */
export const handleModalSubmit = (
  input: ModalInput,
): Effect.Effect<APIInteractionResponse, never, never> =>
  Effect.succeed({
    type: InteractionResponseType.DeferredChannelMessageWithSource,
    data: {
      flags: MessageFlags.Ephemeral,
    },
  } satisfies APIInteractionResponse);
