/**
 * render-verdict.ts — post-judgment verdict reveal.
 *
 * Per SDD §5.4: curator narrative ONLY · NO status enum · NO confidence ·
 * ≤180 words. Per [[chat-medium-presentation-boundary]] §2 drift
 * signature: status enum + confidence STAY INTERNAL.
 *
 * CMP transforms applied:
 *   - verdictToNarrative (T5) — surfaces narrative · NEVER status enum
 *   - phaseToNarrative (T4) — embed title carries cadence prose
 *   - filterTelemetryFromOutput (T7) — defense-in-depth
 */

import type { APIEmbed } from "discord-api-types/v10";
import type { QuestState, QuestVerdict } from "@0xhoneyjar/quests-protocol";
import {
  filterTelemetryFromOutput,
  phaseToNarrative,
  verdictToNarrative,
  type CuratorVoiceProfile,
} from "./transforms.js";

const MAX_BODY_WORDS = 180;

const truncateToWordBudget = (text: string, maxWords: number): string => {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return `${words.slice(0, maxWords).join(" ")}…`;
};

/**
 * Build a verdict-reveal embed. The curator's narrative is the body. The
 * cadence prose is the title. The status enum is never serialized.
 */
export const renderVerdict = (
  state: QuestState,
  verdict: QuestVerdict,
  voice: CuratorVoiceProfile,
): APIEmbed => {
  const title = filterTelemetryFromOutput(phaseToNarrative(state, voice));
  const body = filterTelemetryFromOutput(
    truncateToWordBudget(verdictToNarrative(verdict), MAX_BODY_WORDS),
  );
  const embed: APIEmbed = {
    title,
    description: body,
  };
  if (verdict.curator_voice_quote) {
    embed.footer = {
      text: filterTelemetryFromOutput(verdict.curator_voice_quote),
    };
  }
  return embed;
};
