/**
 * QuestDetailEmbed — single-quest detail view with slot-based composition.
 *
 * Used for the "expanded" quest representation (consumer routes like
 * /quests/[id] in cubquests-dashboard, or the in-thread detail panel in a
 * Discord-attached web view).
 *
 * Per SDD §6.2 + PRD D2 anti-pattern guard: ZERO CSS · slots only.
 */

import type { ComponentType, ReactNode } from "react";
import type { BadgeSpec, Quest } from "./types.js";

export interface QuestDetailEmbedSlots {
  readonly Header?: ComponentType<{ readonly quest: Quest }>;
  readonly Body?: ComponentType<{ readonly quest: Quest }>;
  readonly Reward?: ComponentType<{ readonly badge_spec: BadgeSpec }>;
  readonly Footer?: ComponentType<{ readonly quest: Quest }>;
  readonly Actions?: ComponentType<{
    readonly quest: Quest;
    readonly onAccept?: () => void;
    readonly onSubmit?: () => void;
  }>;
}

export interface QuestDetailEmbedProps extends QuestDetailEmbedSlots {
  readonly quest: Quest;
  readonly className?: string;
  readonly onAccept?: () => void;
  readonly onSubmit?: () => void;
  readonly children?: ReactNode;
}

const DefaultHeader: ComponentType<{ readonly quest: Quest }> = ({ quest }) => (
  <header data-slot="header">{quest.title}</header>
);

const DefaultBody: ComponentType<{ readonly quest: Quest }> = ({ quest }) => (
  <section data-slot="body">{quest.prompt}</section>
);

const DefaultReward: ComponentType<{ readonly badge_spec: BadgeSpec }> = ({
  badge_spec,
}) => (
  <aside data-slot="reward">
    <span data-field="badge-name">{badge_spec.display_name}</span>
    <span data-field="badge-description">{badge_spec.description}</span>
  </aside>
);

const DefaultFooter: ComponentType<{ readonly quest: Quest }> = ({ quest }) => (
  <footer data-slot="footer" data-quest-slug={quest.slug} />
);

const DefaultActions: ComponentType<{
  readonly quest: Quest;
  readonly onAccept?: () => void;
  readonly onSubmit?: () => void;
}> = ({ onAccept, onSubmit }) => (
  <div data-slot="actions">
    <button type="button" onClick={onAccept} data-action="accept">
      Accept
    </button>
    <button type="button" onClick={onSubmit} data-action="submit">
      Submit
    </button>
  </div>
);

export const QuestDetailEmbed = ({
  quest,
  Header = DefaultHeader,
  Body = DefaultBody,
  Reward = DefaultReward,
  Footer = DefaultFooter,
  Actions = DefaultActions,
  className,
  onAccept,
  onSubmit,
  children,
}: QuestDetailEmbedProps): ReactNode => {
  const classProps = className === undefined ? {} : { className };
  const actionsProps = {
    quest,
    ...(onAccept ? { onAccept } : {}),
    ...(onSubmit ? { onSubmit } : {}),
  };
  return (
    <article {...classProps} data-component="QuestDetailEmbed">
      <Header quest={quest} />
      <Body quest={quest} />
      <Reward badge_spec={quest.badge_spec} />
      <Actions {...actionsProps} />
      <Footer quest={quest} />
      {children}
    </article>
  );
};
