/**
 * QuestCard — compact quest representation with slot-based composition.
 *
 * Per SDD §6.2 + PRD D2 anti-pattern guard:
 *   - ZERO CSS · ZERO design tokens · ZERO inline style
 *   - className is pass-through ONLY (no defaults)
 *   - All visual chrome belongs at the consumer via slot components
 *
 * Each slot receives the relevant entity and renders it however the consumer
 * wants. If a slot is omitted, the primitive renders a minimal fallback that
 * surfaces the raw text (no styling).
 */

import type { ComponentType, ReactNode } from "react";
import type { BadgeSpec, Quest } from "./types.js";

export interface QuestCardSlots {
  readonly Title?: ComponentType<{ readonly quest: Quest }>;
  readonly Description?: ComponentType<{ readonly quest: Quest }>;
  readonly Reward?: ComponentType<{ readonly badge_spec: BadgeSpec }>;
  readonly Actions?: ComponentType<{
    readonly quest: Quest;
    readonly onAccept?: () => void;
  }>;
}

export interface QuestCardProps extends QuestCardSlots {
  readonly quest: Quest;
  /** Pass-through className. NO default class is shipped. */
  readonly className?: string;
  /** Optional accept handler propagated to Actions slot. */
  readonly onAccept?: () => void;
  /** Optional children rendered after slot composition (for envelope decoration). */
  readonly children?: ReactNode;
}

const DefaultTitle: ComponentType<{ readonly quest: Quest }> = ({ quest }) => (
  <span data-slot="title">{quest.title}</span>
);

const DefaultDescription: ComponentType<{ readonly quest: Quest }> = ({
  quest,
}) => <span data-slot="description">{quest.prompt}</span>;

const DefaultReward: ComponentType<{ readonly badge_spec: BadgeSpec }> = ({
  badge_spec,
}) => <span data-slot="reward">{badge_spec.display_name}</span>;

const DefaultActions: ComponentType<{
  readonly quest: Quest;
  readonly onAccept?: () => void;
}> = ({ onAccept }) => (
  <button
    type="button"
    onClick={onAccept}
    data-slot="actions"
    data-action="accept"
  >
    Accept
  </button>
);

export const QuestCard = ({
  quest,
  Title = DefaultTitle,
  Description = DefaultDescription,
  Reward = DefaultReward,
  Actions = DefaultActions,
  className,
  onAccept,
  children,
}: QuestCardProps): ReactNode => {
  const classProps = className === undefined ? {} : { className };
  return (
    <article {...classProps} data-component="QuestCard">
      <Title quest={quest} />
      <Description quest={quest} />
      <Reward badge_spec={quest.badge_spec} />
      <Actions quest={quest} {...(onAccept ? { onAccept } : {})} />
      {children}
    </article>
  );
};
