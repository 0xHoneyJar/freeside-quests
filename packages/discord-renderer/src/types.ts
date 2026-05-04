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
} from "discord-api-types/v10";

/**
 * Sprint 1 SCAFFOLD-only EngineConfig stub.
 *
 * Sprint 2 (P2 ENGINE+PERSIST) lands the canonical `EngineConfig` in
 * `@freeside-quests/engine`. This stub exists so the dispatch signatures
 * type-check standalone in Sprint 1.
 *
 * When Sprint 2 lands, replace with:
 *   import type { EngineConfig } from "@freeside-quests/engine";
 */
export interface EngineConfigStub {
  readonly questAcceptanceMode: "open-badge-gated" | "open" | "anon-allowed";
  readonly worldSlug: string;
  readonly submissionStyle: "modal-form" | "inline-thread";
  readonly positiveFrictionDelayMs: number;
}
