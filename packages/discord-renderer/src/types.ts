/**
 * Re-export of the discord-api-types subset used by this package.
 *
 * Per A1 architect lock: descriptor emitter only. We import TYPES from
 * discord-api-types (no runtime) and emit shapes that the consumer bot
 * dispatches. The consumer bot owns the network call.
 */

export type {
  APIInteraction,
  APIInteractionResponse,
  APIChatInputApplicationCommandInteraction,
  APIMessageComponentInteraction,
  APIModalSubmitInteraction,
  APIInteractionResponseChannelMessageWithSource,
  APIInteractionResponseDeferredChannelMessageWithSource,
  APIModalInteractionResponse,
} from "discord-api-types/v10";

export {
  InteractionResponseType,
  InteractionType,
  MessageFlags,
  ComponentType,
  TextInputStyle,
} from "discord-api-types/v10";

/**
 * Public EngineConfig type alias — re-exported from
 * `@0xhoneyjar/quests-engine` so consumers compose against the canonical
 * shape (Sprint 2 ENGINE+PERSIST landed the source-of-truth Schema).
 *
 * Sprint 1's EngineConfigStub is preserved as a deprecated alias for
 * backwards compatibility with the SCAFFOLD smoke tests.
 */
export interface EngineConfigStub {
  readonly questAcceptanceMode: "open-badge-gated" | "open" | "anon-allowed";
  readonly worldSlug: string;
  readonly submissionStyle: "modal-form" | "inline-thread";
  readonly positiveFrictionDelayMs: number;
}
