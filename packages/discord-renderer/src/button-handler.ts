/**
 * button-handler.ts — button interaction custom_id routing.
 *
 * Sprint 3 BOT WIRING: routes by custom_id prefix into engine state-machine
 * transitions. Per SDD §5.2:
 *   - "quest_accept_<id>"  → state-machine accept · ephemeral confirm
 *   - "quest_submit_<id>"  → opens modal (modal_form mode)
 *   - "quest_skip_<id>"    → no-op ack · removes from active set
 *
 * CMP-boundary discipline: every output runs through transforms before
 * serialization (T1 questIdToTitle · T4 phaseToNarrative · T7 telemetry).
 */

import { Effect } from "effect";
import {
  QuestStatePort,
  accept,
  systemClock,
} from "@freeside-quests/engine";
import {
  QUEST_CONTRACT_VERSION,
  type PlayerIdentity,
  type Quest,
  type QuestState,
} from "@freeside-quests/protocol";
import {
  filterTelemetryFromOutput,
  npcIdToDisplayName,
  phaseToNarrative,
  type CharacterRegistry,
  type CuratorVoiceProfile,
} from "./cmp-boundary/transforms.js";
import type { QuestCatalog, EngineConfigShape } from "./slash-command-handler.js";
import {
  type APIInteractionResponse,
  type APIMessageComponentInteraction,
  ComponentType,
  InteractionResponseType,
  MessageFlags,
  TextInputStyle,
} from "./types.js";

export interface ButtonInput {
  readonly interaction: APIMessageComponentInteraction;
  readonly config: EngineConfigShape;
  readonly catalog: QuestCatalog;
  readonly characters: CharacterRegistry;
  readonly voice: CuratorVoiceProfile;
  readonly player: PlayerIdentity;
}

const ephemeralText = (text: string): APIInteractionResponse => ({
  type: InteractionResponseType.ChannelMessageWithSource,
  data: {
    content: filterTelemetryFromOutput(text),
    flags: MessageFlags.Ephemeral,
  },
});

const QUEST_ACCEPT = "quest_accept_";
const QUEST_SUBMIT = "quest_submit_";
const QUEST_SKIP = "quest_skip_";

const extractQuestId = (custom_id: string, prefix: string): string =>
  custom_id.slice(prefix.length);

const handleAcceptButton = (
  input: ButtonInput,
  questId: string,
): Effect.Effect<APIInteractionResponse, never, QuestStatePort> =>
  Effect.gen(function* () {
    const quest: Quest | undefined = yield* input.catalog.findQuest(
      input.config.worldSlug,
      questId,
    );
    if (!quest) return ephemeralText("that quest is not on the path");

    const port = yield* QuestStatePort;
    const starting: QuestState = {
      quest_id: quest.quest_id,
      player: input.player,
      npc_id: quest.npc_pointer,
      phase: "browsing",
      trace_id: `${input.config.worldSlug}|${quest.quest_id}|${input.player.discord_id}|${Date.now()}`,
      contract_version: QUEST_CONTRACT_VERSION,
    };
    const acceptedState = yield* accept(starting, systemClock).pipe(
      Effect.catchTag("InvalidPhaseTransitionError", () => Effect.succeed(starting)),
    );
    // At-least-once delivery (AC-3.5): save MUST be idempotent · failure
    // does NOT block the user-visible ack (engine retries via ON CONFLICT).
    yield* port.save(acceptedState).pipe(Effect.catchAll(() => Effect.void));

    const npcName = filterTelemetryFromOutput(
      npcIdToDisplayName(quest.npc_pointer, input.characters),
    );
    const cadence = filterTelemetryFromOutput(
      phaseToNarrative(acceptedState, input.voice),
    );
    return ephemeralText(`${npcName} · ${cadence}`);
  });

const handleSubmitButton = (
  input: ButtonInput,
  questId: string,
): APIInteractionResponse => {
  // Submit button always opens a modal (button → modal flow).
  return {
    type: InteractionResponseType.Modal,
    data: {
      custom_id: `quest_submission_${questId}`,
      title: "your offering",
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.TextInput,
              custom_id: "approach",
              label: "approach (1 line)",
              style: TextInputStyle.Short,
              min_length: 1,
              max_length: 100,
              required: true,
            },
          ],
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.TextInput,
              custom_id: "response",
              label: "response (paragraph)",
              style: TextInputStyle.Paragraph,
              min_length: 1,
              max_length: 4000,
              required: true,
            },
          ],
        },
      ],
    },
  };
};

const handleSkipButton = (
  _input: ButtonInput,
): APIInteractionResponse => ephemeralText("the path remains open");

/**
 * Handle button-component interaction with quest_* custom_id.
 */
export const handleButton = (
  input: ButtonInput,
): Effect.Effect<APIInteractionResponse, never, QuestStatePort> => {
  const customId = input.interaction.data.custom_id;
  if (customId.startsWith(QUEST_ACCEPT)) {
    return handleAcceptButton(input, extractQuestId(customId, QUEST_ACCEPT));
  }
  if (customId.startsWith(QUEST_SUBMIT)) {
    return Effect.succeed(
      handleSubmitButton(input, extractQuestId(customId, QUEST_SUBMIT)),
    );
  }
  if (customId.startsWith(QUEST_SKIP)) {
    return Effect.succeed(handleSkipButton(input));
  }
  return Effect.succeed(ephemeralText("unknown button · the wind is silent"));
};
