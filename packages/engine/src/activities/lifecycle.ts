/**
 * Activity lifecycle state machine (T2.7 · SDD §3.5 + per Activity schema).
 *
 * Drives an Activity through its 5-state lifecycle. Backwards transitions
 * are FORBIDDEN. EXPIRED is terminal. The engine emits ActivityLifecycleAdvanced
 * events on every valid transition so downstream replay produces the same
 * sequence.
 *
 *   DEFINED → ACTIVE → PARTICIPATING → COMPLETED
 *                                  ↘ EXPIRED (terminal)
 *
 * Note: the protocol exports `ActivityLifecycleState` as a literal union.
 * This file holds the transition rules + the LifecycleError sealed union.
 */
import { Data, Effect } from "effect";

import type { ActivityLifecycleState } from "@0xhoneyjar/quests-protocol";

/**
 * Adjacency map: source → set of legal target states. Anything outside the
 * set ⇒ LifecycleError.InvalidTransition. The map is the SINGLE source of
 * truth for transition legality; tests assert against it directly.
 */
const TRANSITION_MAP: Readonly<
  Record<ActivityLifecycleState, ReadonlySet<ActivityLifecycleState>>
> = {
  DEFINED: new Set<ActivityLifecycleState>(["ACTIVE"]),
  ACTIVE: new Set<ActivityLifecycleState>(["PARTICIPATING", "EXPIRED"]),
  PARTICIPATING: new Set<ActivityLifecycleState>(["COMPLETED", "EXPIRED"]),
  COMPLETED: new Set<ActivityLifecycleState>(),
  EXPIRED: new Set<ActivityLifecycleState>(),
};

/**
 * LifecycleError — sealed Data.TaggedError union surfaced by the state
 * machine. Variants:
 *   - InvalidTransition  → caller asked for a transition not in the map
 *   - TerminalState      → caller asked to advance from COMPLETED / EXPIRED
 */
export class InvalidTransition extends Data.TaggedError("InvalidTransition")<{
  readonly from: ActivityLifecycleState;
  readonly to: ActivityLifecycleState;
}> {}

export class TerminalState extends Data.TaggedError("TerminalState")<{
  readonly state: ActivityLifecycleState;
}> {}

export type LifecycleError = InvalidTransition | TerminalState;

/**
 * advance — pure transition function. Effect-typed so consumers can chain
 * lifecycle moves into the same pipeline that emits events.
 */
export const advance = (
  from: ActivityLifecycleState,
  to: ActivityLifecycleState,
): Effect.Effect<ActivityLifecycleState, LifecycleError> =>
  Effect.gen(function* () {
    const allowed = TRANSITION_MAP[from];
    if (allowed.size === 0) {
      return yield* Effect.fail(new TerminalState({ state: from }));
    }
    if (!allowed.has(to)) {
      return yield* Effect.fail(new InvalidTransition({ from, to }));
    }
    return to;
  });

/**
 * isTerminal — pure predicate. Useful for engine loops that decide
 * whether to continue scheduling work on an activity.
 */
export const isTerminal = (state: ActivityLifecycleState): boolean =>
  TRANSITION_MAP[state].size === 0;

/**
 * legalTransitionsFrom — returns the set of allowed next states. Empty
 * set means terminal (COMPLETED or EXPIRED).
 */
export const legalTransitionsFrom = (
  state: ActivityLifecycleState,
): ReadonlySet<ActivityLifecycleState> => TRANSITION_MAP[state];
