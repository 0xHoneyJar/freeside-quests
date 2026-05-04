/**
 * ProgressTracker — QuestState phase visualizer.
 *
 * Renders the 5-phase pill sequence (browsing → accepted → submitted → judged
 * → completed) with the current phase emphasized via the Phase slot. Pure
 * structure: consumers style via Phase slot or className pass-through.
 *
 * Per SDD §6.2 + PRD D2 anti-pattern guard: ZERO CSS · slots only.
 */

import type { ComponentType, ReactNode } from "react";
import type { QuestPhase, QuestState } from "./types.js";

const PHASE_ORDER: readonly QuestPhase[] = [
  "browsing",
  "accepted",
  "submitted",
  "judged",
  "completed",
];

export interface ProgressTrackerSlots {
  readonly Phase?: ComponentType<{
    readonly phase: QuestPhase;
    readonly isCurrent: boolean;
    readonly isComplete: boolean;
  }>;
}

export interface ProgressTrackerProps extends ProgressTrackerSlots {
  readonly state: QuestState;
  readonly className?: string;
  readonly children?: ReactNode;
}

const DefaultPhase: ComponentType<{
  readonly phase: QuestPhase;
  readonly isCurrent: boolean;
  readonly isComplete: boolean;
}> = ({ phase, isCurrent, isComplete }) => (
  <span
    data-slot="phase"
    data-phase={phase}
    data-current={isCurrent ? "true" : "false"}
    data-complete={isComplete ? "true" : "false"}
  >
    {phase}
  </span>
);

const phaseRank = (phase: QuestPhase): number => PHASE_ORDER.indexOf(phase);

export const ProgressTracker = ({
  state,
  Phase = DefaultPhase,
  className,
  children,
}: ProgressTrackerProps): ReactNode => {
  const classProps = className === undefined ? {} : { className };
  const currentRank = phaseRank(state.phase);
  return (
    <nav
      {...classProps}
      data-component="ProgressTracker"
      data-current-phase={state.phase}
    >
      {PHASE_ORDER.map((phase, idx) => (
        <Phase
          key={phase}
          phase={phase}
          isCurrent={phase === state.phase}
          isComplete={idx < currentRank}
        />
      ))}
      {children}
    </nav>
  );
};
