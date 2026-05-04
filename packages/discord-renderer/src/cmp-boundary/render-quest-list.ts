/**
 * render-quest-list.ts — `/quest browse` list renderer.
 *
 * Per SDD §5.4: up to 5 quests per response · select_menu for >5.
 * Body ≤180 words guard per [[discord-native-register]].
 *
 * Sprint-3 ships the basic list-of-embeds shape. Each quest title +
 * short prompt excerpt. CMP transforms applied:
 *   - questIdToTitle (T1) — listing renders titles, not IDs
 *   - filterTelemetryFromOutput (T7) — defense-in-depth on prompt excerpts
 */

import type { APIEmbed } from "discord-api-types/v10";
import type { Quest } from "@0xhoneyjar/quests-protocol";
import {
  filterTelemetryFromOutput,
  questIdToTitle,
} from "./transforms.js";

const MAX_LIST_ITEMS = 5;
const PROMPT_EXCERPT_CHARS = 220;

/**
 * Build a list of `APIEmbed` descriptors — one per quest, capped at 5.
 * Consumers wanting >5 should use `select_menu` (Cycle Q v2+).
 *
 * The bot dispatches these via `data.embeds = result` in the
 * APIInteractionResponse `data` field.
 */
export const renderQuestList = (quests: readonly Quest[]): APIEmbed[] => {
  const head = quests.slice(0, MAX_LIST_ITEMS);
  return head.map((q) => {
    const title = questIdToTitle(q);
    const excerpt = filterTelemetryFromOutput(
      q.prompt.length > PROMPT_EXCERPT_CHARS
        ? `${q.prompt.slice(0, PROMPT_EXCERPT_CHARS - 1)}…`
        : q.prompt,
    );
    return {
      title: filterTelemetryFromOutput(title),
      description: excerpt,
    } satisfies APIEmbed;
  });
};
