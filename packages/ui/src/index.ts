/**
 * @freeside-quests/ui — unstyled React primitives for quest UIs.
 *
 * Per Cycle Q SDD §6 + PRD D2:
 *   - 5 slot-based primitives
 *   - ZERO CSS · ZERO design tokens · ZERO inline style
 *   - className pass-through only
 *   - Each consumer (cubquests-dashboard · per-world bots · future Farcaster
 *     Mini App) ships its own skin atop these primitives.
 *
 * Anti-pattern guard: see README.md and __tests__/component-isolation.test.tsx
 *   - NEVER ship a default skin
 *   - NEVER hardcode className literals
 *   - NEVER use style={...} attributes
 *   - NEVER import a .css file
 */

export { QuestCard } from "./QuestCard.js";
export type { QuestCardProps, QuestCardSlots } from "./QuestCard.js";

export { QuestDetailEmbed } from "./QuestDetailEmbed.js";
export type {
  QuestDetailEmbedProps,
  QuestDetailEmbedSlots,
} from "./QuestDetailEmbed.js";

export { BadgeShowcase } from "./BadgeShowcase.js";
export type {
  BadgeShowcaseItemProps,
  BadgeShowcaseProps,
} from "./BadgeShowcase.js";

export { ProgressTracker } from "./ProgressTracker.js";
export type {
  ProgressTrackerProps,
  ProgressTrackerSlots,
} from "./ProgressTracker.js";

export { VerdictReveal, useVerdictReveal } from "./VerdictReveal.js";
export type { VerdictRevealProps } from "./VerdictReveal.js";

export type {
  BadgeArtifact,
  BadgeSpec,
  PlayerIdentity,
  Quest,
  QuestPhase,
  QuestState,
  QuestVerdict,
} from "./types.js";
