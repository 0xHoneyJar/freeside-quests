/**
 * thread-spawner.ts — D7-default mention+thread surface.
 *
 * Sprint 1 SCAFFOLD: signature lands · returns thread-create descriptor.
 * Sprint 3 BOT WIRING: connects to character.persona.yaml mention_allowed_channels
 * + spawns Discord thread + scopes all subsequent quest interactions to thread.
 *
 * Per SDD §5.6 + [[explicit-invocation-anti-spam]]:
 *   - mention triggers thread (NEVER unsolicited)
 *   - all interactions scoped to thread
 */

import { Effect } from "effect";
import type { EngineConfigStub } from "./types.js";

export interface ThreadSpawnInput {
  readonly channel_id: string;
  readonly parent_message_id: string;
  readonly user_id: string;
  readonly mention_text: string;
  readonly config: EngineConfigStub;
}

/** Descriptor for thread creation. The bot owns the actual API call. */
export interface ThreadCreateDescriptor {
  readonly action: "create-thread";
  readonly parent_message_id: string;
  readonly channel_id: string;
  readonly thread_name: string;
  readonly auto_archive_minutes: 60 | 1440 | 4320 | 10080;
  readonly initial_response_text: string;
}

/**
 * Build a thread-create descriptor in response to a mention in an allowed channel.
 *
 * Sprint 3 will:
 *   1. Validate the channel is in `character.persona.yaml mention_allowed_channels`
 *   2. Build thread name from quest context (e.g., "quest with <handle>")
 *   3. Return descriptor for the bot to dispatch
 *   4. Bot creates thread + posts initial response inside it
 */
export const buildThreadSpawnDescriptor = (
  input: ThreadSpawnInput,
): Effect.Effect<ThreadCreateDescriptor, never, never> =>
  Effect.succeed({
    action: "create-thread",
    parent_message_id: input.parent_message_id,
    channel_id: input.channel_id,
    thread_name: `quest · ${input.config.worldSlug}`,
    auto_archive_minutes: 1440,
    initial_response_text: "[scaffold] mention received · Sprint 3 lands the surface",
  });
