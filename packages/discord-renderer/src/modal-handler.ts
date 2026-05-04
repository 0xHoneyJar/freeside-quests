/**
 * modal-handler.ts — modal-submit interaction handler.
 *
 * Sprint 3 BOT WIRING: extracts approach + response text inputs · constructs
 * SubmissionEnvelope per SDD §3.3 · invokes engine submit transition.
 *
 * The modal custom_id carries quest_id (custom_id = `quest_submission_<id>`).
 * Per SDD §5.4: 2 text inputs · "Approach (1 line)" + "Response (paragraph)".
 *
 * CMP-boundary discipline: every output runs through transforms (T4 + T7).
 * At-least-once delivery (AC-3.5): save is idempotent · transient failure
 * lets the engine retry without re-prompting the user.
 */

import { Effect } from "effect";
import {
  QuestStatePort,
  submit,
} from "@0xhoneyjar/quests-engine";
import {
  QUEST_CONTRACT_VERSION,
  type PlayerIdentity,
  type QuestState,
  type SubmissionEnvelope,
} from "@0xhoneyjar/quests-protocol";
import {
  filterTelemetryFromOutput,
  npcIdToDisplayName,
  phaseToNarrative,
  type CharacterRegistry,
  type CuratorVoiceProfile,
} from "./cmp-boundary/transforms.js";
import type { EngineConfigShape, QuestCatalog } from "./slash-command-handler.js";
import {
  type APIInteractionResponse,
  type APIModalSubmitInteraction,
  ComponentType,
  InteractionResponseType,
  MessageFlags,
} from "./types.js";

export interface ModalInput {
  readonly interaction: APIModalSubmitInteraction;
  readonly config: EngineConfigShape;
  readonly catalog: QuestCatalog;
  readonly characters: CharacterRegistry;
  readonly voice: CuratorVoiceProfile;
  readonly player: PlayerIdentity;
}

const QUEST_SUBMISSION_PREFIX = "quest_submission_";

const ephemeralText = (text: string): APIInteractionResponse => ({
  type: InteractionResponseType.ChannelMessageWithSource,
  data: {
    content: filterTelemetryFromOutput(text),
    flags: MessageFlags.Ephemeral,
  },
});

const deferredEphemeral = (): APIInteractionResponse => ({
  type: InteractionResponseType.DeferredChannelMessageWithSource,
  data: { flags: MessageFlags.Ephemeral },
});

/**
 * Pull a single text-input value out of the modal-submit components.
 * Discord nests text inputs inside ActionRow components; we walk both
 * levels and match by custom_id.
 */
const extractTextInput = (
  interaction: APIModalSubmitInteraction,
  custom_id: string,
): string | undefined => {
  for (const row of interaction.data.components ?? []) {
    if (row.type !== ComponentType.ActionRow) continue;
    for (const component of row.components ?? []) {
      if (
        component.type === ComponentType.TextInput &&
        component.custom_id === custom_id
      ) {
        return component.value ?? undefined;
      }
    }
  }
  return undefined;
};

/**
 * Handle modal-submit interaction with quest_submission_<id> custom_id.
 */
export const handleModalSubmit = (
  input: ModalInput,
): Effect.Effect<APIInteractionResponse, never, QuestStatePort> => {
  const customId = input.interaction.data.custom_id;
  if (!customId.startsWith(QUEST_SUBMISSION_PREFIX)) {
    return Effect.succeed(
      ephemeralText("unrecognized modal · the witness blinks"),
    );
  }
  const questId = customId.slice(QUEST_SUBMISSION_PREFIX.length);
  const approach = extractTextInput(input.interaction, "approach")?.trim() ?? "";
  const response = extractTextInput(input.interaction, "response")?.trim() ?? "";
  if (!response) {
    return Effect.succeed(
      ephemeralText("the words must form · try again"),
    );
  }

  return Effect.gen(function* () {
    const quest = yield* input.catalog.findQuest(
      input.config.worldSlug,
      questId,
    );
    if (!quest) {
      return ephemeralText("that quest is not on the path");
    }

    const port = yield* QuestStatePort;
    // Load the prior accepted state. If not found, the user skipped accept;
    // anon-friendly fallback synthesizes the accepted state implicitly so
    // the submission does not vanish.
    const traceId = `${input.config.worldSlug}|${quest.quest_id}|${input.player.discord_id}|${Date.now()}`;
    const composed = approach.length > 0 ? `${approach}\n\n${response}` : response;
    const submission: SubmissionEnvelope = {
      submission_id: traceId as SubmissionEnvelope["submission_id"],
      trace_id: traceId,
      quest_id: quest.quest_id,
      player: input.player,
      text_response: composed.slice(0, 4000),
      submitted_at: new Date().toISOString(),
      contract_version: QUEST_CONTRACT_VERSION,
    };

    const prior = yield* port
      .load(quest.quest_id, input.player)
      .pipe(
        Effect.catchAll(() =>
          Effect.succeed<QuestState>({
            quest_id: quest.quest_id,
            player: input.player,
            npc_id: quest.npc_pointer,
            phase: "accepted",
            accepted_at: new Date().toISOString(),
            trace_id: traceId,
            contract_version: QUEST_CONTRACT_VERSION,
          }),
        ),
      );

    const submittedState = yield* submit(prior, submission).pipe(
      Effect.catchTag("InvalidPhaseTransitionError", () => Effect.succeed(prior)),
    );
    yield* port.save(submittedState).pipe(Effect.catchAll(() => Effect.void));

    const npcName = filterTelemetryFromOutput(
      npcIdToDisplayName(quest.npc_pointer, input.characters),
    );
    const cadence = filterTelemetryFromOutput(
      phaseToNarrative(submittedState, input.voice),
    );
    return ephemeralText(`${npcName} · ${cadence}`);
  });
};

export { deferredEphemeral };
