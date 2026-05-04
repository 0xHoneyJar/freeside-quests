/**
 * render-quest-detail.ts — single-quest detail renderer.
 *
 * Per SDD §5.4: body ≤180 words per [[discord-native-register]].
 *
 * Sprint-3 ships the embed-with-action-row shape. CMP transforms applied:
 *   - questIdToTitle (T1)
 *   - npcIdToDisplayName (T2) — embed footer/author shows display name
 *   - filterTelemetryFromOutput (T7) — defense-in-depth
 */

import type {
  APIActionRowComponent,
  APIEmbed,
  APIMessageActionRowComponent,
} from "discord-api-types/v10";
import { ButtonStyle, ComponentType } from "discord-api-types/v10";
import type { Quest } from "@freeside-quests/protocol";
import {
  filterTelemetryFromOutput,
  npcIdToDisplayName,
  questIdToTitle,
  type CharacterRegistry,
} from "./transforms.js";

const MAX_BODY_WORDS = 180;

export interface QuestDetailRender {
  readonly embed: APIEmbed;
  readonly components: readonly APIActionRowComponent<APIMessageActionRowComponent>[];
}

const truncateToWordBudget = (text: string, maxWords: number): string => {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return `${words.slice(0, maxWords).join(" ")}…`;
};

/**
 * Build a single-quest detail render: one embed + one action row with
 * Accept + Skip buttons.
 *
 * The button custom_id encodes the quest_id with kebab-case slug shape
 * (e.g. `quest_accept_<slug-id>`) — slug is human-readable; UUIDs would
 * be filtered by T7.
 */
export const renderQuestDetail = (
  quest: Quest,
  registry: CharacterRegistry,
): QuestDetailRender => {
  const title = filterTelemetryFromOutput(questIdToTitle(quest));
  const body = filterTelemetryFromOutput(
    truncateToWordBudget(quest.prompt, MAX_BODY_WORDS),
  );
  const npcName = filterTelemetryFromOutput(
    npcIdToDisplayName(quest.npc_pointer, registry),
  );

  const embed: APIEmbed = {
    title,
    description: body,
    author: { name: npcName },
  };

  const components: APIActionRowComponent<APIMessageActionRowComponent>[] = [
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Primary,
          label: "Accept",
          custom_id: `quest_accept_${quest.quest_id}`,
        },
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          label: "Skip",
          custom_id: `quest_skip_${quest.quest_id}`,
        },
      ],
    },
  ];

  return { embed, components };
};
