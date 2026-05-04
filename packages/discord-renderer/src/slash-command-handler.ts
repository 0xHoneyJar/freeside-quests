/**
 * slash-command-handler.ts — slash dispatch for /quest browse|accept|submit|status.
 *
 * Sprint 3 BOT WIRING: full subcommand routing + CMP transforms applied.
 * Per SDD §5.2 dispatch surface + §5.4 component primitives.
 *
 * Routing:
 *   - "browse" → renderQuestList against per-guild QuestCatalog
 *   - "accept" → state-machine accept transition · ephemeral confirm
 *   - "submit" → opens modal (modal_form) OR inline prompt (inline_thread)
 *   - "status" → ephemeral list of user's QuestStates
 *
 * The engine `QuestStatePort` is injected via Effect Context; this handler
 * declares its dependency and the bot consumer provides the Layer.
 */

import { Effect } from "effect";
import {
  QuestStatePort,
  accept,
  systemClock,
} from "@0xhoneyjar/quests-engine";
import type {
  PlayerIdentity,
  Quest,
  QuestState,
} from "@0xhoneyjar/quests-protocol";
import { QUEST_CONTRACT_VERSION } from "@0xhoneyjar/quests-protocol";
import { renderQuestDetail } from "./cmp-boundary/render-quest-detail.js";
import { renderQuestList } from "./cmp-boundary/render-quest-list.js";
import {
  filterTelemetryFromOutput,
  npcIdToDisplayName,
  phaseToNarrative,
  type CharacterRegistry,
  type CuratorVoiceProfile,
} from "./cmp-boundary/transforms.js";
import {
  type APIChatInputApplicationCommandInteraction,
  type APIInteractionResponse,
  ComponentType,
  InteractionResponseType,
  MessageFlags,
  TextInputStyle,
} from "./types.js";

// ---------------------------------------------------------------------------
// Injected per-guild context (provided by the bot consumer · NOT substrate)
// ---------------------------------------------------------------------------

/**
 * Per-world catalog of available quests. The bot consumer maintains this
 * (typically loaded from a CMS or curator-authored YAML); substrate does
 * not author quests.
 */
export interface QuestCatalog {
  readonly listAvailableQuests: (
    worldSlug: string,
  ) => Effect.Effect<readonly Quest[], never>;
  readonly findQuest: (
    worldSlug: string,
    quest_id: string,
  ) => Effect.Effect<Quest | undefined, never>;
}

/**
 * Per-world EngineConfig — mirrors @0xhoneyjar/quests-engine EngineConfig.
 * (Re-declared here as a structural type to avoid a hard dep on engine's
 * Schema export at the descriptor-emitter layer.)
 */
export interface EngineConfigShape {
  readonly questAcceptanceMode: "open" | "auth-required" | "open-badge-gated";
  readonly worldSlug: string;
  readonly submissionStyle: "inline_thread" | "modal_form";
  readonly positiveFrictionDelayMs: number;
}

export interface SlashCommandInput {
  readonly interaction: APIChatInputApplicationCommandInteraction;
  readonly config: EngineConfigShape;
  readonly catalog: QuestCatalog;
  readonly characters: CharacterRegistry;
  readonly voice: CuratorVoiceProfile;
  /** The resolved player identity (auth-resolved by the bot before dispatch). */
  readonly player: PlayerIdentity;
}

// ---------------------------------------------------------------------------
// Sub-command extractors
// ---------------------------------------------------------------------------

const getSubcommand = (
  interaction: APIChatInputApplicationCommandInteraction,
): string | undefined => {
  const opts = interaction.data.options;
  if (!opts || opts.length === 0) return undefined;
  const first = opts[0];
  if (!first) return undefined;
  // Subcommand option type is 1 in Discord's API
  if (first.type !== 1) return undefined;
  return first.name;
};

const getSubcommandStringOption = (
  interaction: APIChatInputApplicationCommandInteraction,
  optionName: string,
): string | undefined => {
  const opts = interaction.data.options;
  if (!opts || opts.length === 0) return undefined;
  const sub = opts[0];
  if (!sub) return undefined;
  if (sub.type !== 1 || !("options" in sub) || !sub.options) return undefined;
  const found = sub.options.find((o) => o.name === optionName);
  if (!found || found.type !== 3) return undefined;
  return typeof found.value === "string" ? found.value : undefined;
};

// ---------------------------------------------------------------------------
// Sub-command handlers
// ---------------------------------------------------------------------------

const ephemeralText = (text: string): APIInteractionResponse => ({
  type: InteractionResponseType.ChannelMessageWithSource,
  data: {
    content: filterTelemetryFromOutput(text),
    flags: MessageFlags.Ephemeral,
  },
});

const handleBrowse = (
  input: SlashCommandInput,
): Effect.Effect<APIInteractionResponse, never, never> =>
  input.catalog.listAvailableQuests(input.config.worldSlug).pipe(
    Effect.map((quests): APIInteractionResponse => {
      if (quests.length === 0) {
        return ephemeralText("the path is quiet · no quests open here yet");
      }
      const embeds = renderQuestList(quests);
      return {
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { embeds, flags: MessageFlags.Ephemeral },
      };
    }),
  );

const handleAccept = (
  input: SlashCommandInput,
): Effect.Effect<APIInteractionResponse, never, QuestStatePort> => {
  const questId = getSubcommandStringOption(input.interaction, "quest_id");
  if (!questId) {
    return Effect.succeed(
      ephemeralText("missing quest_id · try /quest browse first"),
    );
  }

  return Effect.gen(function* () {
    const quest = yield* input.catalog.findQuest(input.config.worldSlug, questId);
    if (!quest) {
      return ephemeralText("that quest is not on the path");
    }

    const port = yield* QuestStatePort;
    const startingState: QuestState = {
      quest_id: quest.quest_id,
      player: input.player,
      npc_id: quest.npc_pointer,
      phase: "browsing",
      trace_id: `${input.config.worldSlug}|${quest.quest_id}|${input.player.discord_id}|${Date.now()}`,
      contract_version: QUEST_CONTRACT_VERSION,
    };
    const accepted = yield* accept(startingState, systemClock).pipe(
      Effect.catchTag("InvalidPhaseTransitionError", () =>
        Effect.succeed(startingState),
      ),
    );
    yield* port.save(accepted).pipe(Effect.catchAll(() => Effect.void));

    const npcName = filterTelemetryFromOutput(
      npcIdToDisplayName(quest.npc_pointer, input.characters),
    );
    const cadence = filterTelemetryFromOutput(
      phaseToNarrative(accepted, input.voice),
    );
    return ephemeralText(`${npcName} · ${cadence}`);
  });
};

const handleSubmit = (
  input: SlashCommandInput,
): Effect.Effect<APIInteractionResponse, never, never> => {
  const questId = getSubcommandStringOption(input.interaction, "quest_id");
  if (!questId) {
    return Effect.succeed(
      ephemeralText("missing quest_id · accept a quest first"),
    );
  }

  if (input.config.submissionStyle === "modal_form") {
    return Effect.succeed({
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
    });
  }

  // inline_thread: prompt user to reply in thread
  return Effect.succeed(
    ephemeralText("reply here · the witness reads your words"),
  );
};

const handleStatus = (
  input: SlashCommandInput,
): Effect.Effect<APIInteractionResponse, never, QuestStatePort> =>
  Effect.gen(function* () {
    const port = yield* QuestStatePort;
    const states = yield* port
      .list(input.player)
      .pipe(Effect.catchAll(() => Effect.succeed([] as readonly QuestState[])));

    if (states.length === 0) {
      return ephemeralText("no marks yet · /quest browse to begin");
    }
    const lines = states.slice(0, 10).map((s) => {
      const cadence = phaseToNarrative(s, input.voice);
      const npcName = npcIdToDisplayName(s.npc_id, input.characters);
      return filterTelemetryFromOutput(`${npcName} · ${cadence}`);
    });
    return ephemeralText(lines.join("\n"));
  });

// ---------------------------------------------------------------------------
// Single handler · routes by subcommand
// ---------------------------------------------------------------------------

/**
 * Handle /quest <subcommand> slash command interaction.
 */
export const handleSlashCommand = (
  input: SlashCommandInput,
): Effect.Effect<APIInteractionResponse, never, QuestStatePort> => {
  const subcommand = getSubcommand(input.interaction);
  switch (subcommand) {
    case "browse":
      return handleBrowse(input);
    case "accept":
      return handleAccept(input);
    case "submit":
      return handleSubmit(input);
    case "status":
      return handleStatus(input);
    default:
      return Effect.succeed(
        ephemeralText(
          "unknown command · try /quest browse|accept|submit|status",
        ),
      );
  }
};
