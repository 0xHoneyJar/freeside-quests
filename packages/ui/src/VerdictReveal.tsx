/**
 * VerdictReveal — curator-narrative reveal with phase-callbacks.
 *
 * Per SDD §6.2 phase-callbacks pattern:
 *   - children render inside a context that exposes the QuestState
 *   - onPhaseEnter fires once when state.phase changes
 *   - onArmed / onComplete fire at specific phase transitions
 *
 * Per [[chat-medium-presentation-boundary]] §2 drift signature:
 *   - VerdictReveal NEVER surfaces a verdict status enum (PASS/FAIL/etc)
 *   - Only narrative text is consumer-rendered
 *
 * Per SDD §6.2 + PRD D2: ZERO CSS · phase callbacks · context-based composition.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type { QuestPhase, QuestState, QuestVerdict } from "./types.js";

interface VerdictRevealContextValue {
  readonly state: QuestState;
  readonly verdict: QuestVerdict | null;
}

const VerdictRevealContext = createContext<VerdictRevealContextValue | null>(
  null,
);

/** Hook for children to access the current QuestState + Verdict. */
export const useVerdictReveal = (): VerdictRevealContextValue => {
  const ctx = useContext(VerdictRevealContext);
  if (ctx === null) {
    throw new Error(
      "useVerdictReveal must be called within <VerdictReveal>. Per SDD §6.2.",
    );
  }
  return ctx;
};

export interface VerdictRevealProps {
  readonly state: QuestState;
  /** Optional verdict narrative (curator output). Null = not yet judged. */
  readonly verdict?: QuestVerdict | null;
  readonly onPhaseEnter?: (phase: QuestPhase) => void;
  /** Fires once when state transitions into "judged". */
  readonly onArmed?: () => void;
  /** Fires once when state transitions into "completed". */
  readonly onComplete?: () => void;
  readonly className?: string;
  readonly children: ReactNode;
}

export const VerdictReveal = ({
  state,
  verdict = null,
  onPhaseEnter,
  onArmed,
  onComplete,
  className,
  children,
}: VerdictRevealProps): ReactNode => {
  const lastPhaseRef = useRef<QuestPhase | null>(null);

  useEffect(() => {
    const previous = lastPhaseRef.current;
    const current = state.phase;
    if (previous !== current) {
      lastPhaseRef.current = current;
      onPhaseEnter?.(current);
      if (current === "judged") {
        onArmed?.();
      }
      if (current === "completed") {
        onComplete?.();
      }
    }
  }, [state.phase, onPhaseEnter, onArmed, onComplete]);

  const ctxValue: VerdictRevealContextValue = { state, verdict };
  const classProps = className === undefined ? {} : { className };

  return (
    <section
      {...classProps}
      data-component="VerdictReveal"
      data-current-phase={state.phase}
    >
      <VerdictRevealContext.Provider value={ctxValue}>
        {children}
      </VerdictRevealContext.Provider>
    </section>
  );
};
