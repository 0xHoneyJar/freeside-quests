/**
 * render-badge-reveal.ts — post-completion badge reveal.
 *
 * Per SDD §5.4: image attachment · ≤8MB cap · WebP preferred.
 * Substrate ships the URI; Cycle B asset-pipeline binds variant resolution
 * at port-adapter swap.
 *
 * CMP transforms applied:
 *   - badgeUriToVariant (T6) — variant URL via consumer constraint
 *   - phaseToNarrative (T4) — title is curator cadence
 *   - filterTelemetryFromOutput (T7) — defense-in-depth
 */

import type { APIEmbed } from "discord-api-types/v10";
import type { BadgeArtifact, QuestState } from "@0xhoneyjar/quests-protocol";
import {
  badgeUriToVariant,
  filterTelemetryFromOutput,
  phaseToNarrative,
  type ConsumerConstraint,
  type CuratorVoiceProfile,
} from "./transforms.js";

/**
 * Build a badge-reveal embed. The image URL is the variant URI per
 * consumer constraint; substrate doesn't lock format choice.
 *
 * The bot consumer either inlines the URL into the embed (Discord fetches)
 * or attaches bytes via webhook attachment when the chat-medium blocks
 * URL resolution (per [[environment-aware-composition]] doctrine candidate
 * proven by V0.7-A.3 cycle).
 */
export const renderBadgeReveal = (
  state: QuestState,
  badge: BadgeArtifact,
  voice: CuratorVoiceProfile,
  consumer: ConsumerConstraint = { chat_medium: "discord", prefer: "webp" },
): APIEmbed => {
  const title = filterTelemetryFromOutput(phaseToNarrative(state, voice));
  const variantUri = badgeUriToVariant(badge.uri, consumer);
  return {
    title,
    image: { url: variantUri },
  };
};
