/**
 * @freeside-quests/engine — headless quest engine.
 *
 * Cycle-1 (2026-05-03) lands the substrate-step dispatch bridging
 * (Plane-3 gateway/listener logic). Future cycles will land:
 *   - quest publish/query/complete/claim flows
 *   - badge issuance logic
 *   - raffle entry/draw flows
 */

export {
  dispatchEssayQuest,
  dispatchAndResolve,
  resolveVerdict,
  DispatchError,
  type EssayGraderInput,
  type EssayGraderOutput,
  type ResolutionHandlers,
} from "./dispatch.js";
