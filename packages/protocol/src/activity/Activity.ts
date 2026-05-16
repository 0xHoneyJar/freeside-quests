import { Schema } from "effect";

import { ActivityId } from "../branded/ActivityId.js";
import { EventId } from "../branded/EventId.js";
import { PeriodKey } from "../branded/PeriodKey.js";
import { WorldId } from "../branded/WorldId.js";
import { ActivityKind } from "./ActivityKind.js";
import { ActivityReward } from "./ActivityReward.js";
import { ActivityStep } from "./ActivityStep.js";

/**
 * Activity — the canonical supertype for every freeside-activities Activity
 * (FR-1 + CL-Activity-1..4).
 *
 * Field semantics (per PRD §FR-1):
 *   - `id`                       — content-addressable ActivityId (FR-12 derivation lives in SDD §5.6)
 *   - `kind`                     — sealed-union (FR-2) · 4 built-ins + WorldDefined seam
 *   - `period_key`               — null=quest · ISO-week=mission · custom=season (CL-Activity-3)
 *   - `steps`                    — ordered ActivityStep array (T1.5 fills in the full step shape)
 *   - `reward`                   — sealed ActivityReward (T1.6 fills in the full reward sealed-enum)
 *   - `reward_state_id`          — null|EventId pointer into the RewardState async machine
 *   - `completion_event_schema`  — $id reference to event schema (FR-5)
 *   - `world`                    — optional binding · null=cross-world · cross-links FR-12
 *   - `schema_version`           — literal '1.0.0' (additive minor bumps allowed per VERSIONING.md)
 *   - `lifecycle_state`          — DEFINED → ACTIVE → PARTICIPATING → COMPLETED|EXPIRED (CL-Activity-4)
 *   - `$id`                      — schema identity URI
 *
 * Constraints honored at this layer:
 *   - **CL-Activity-1** — every field shape is JCS-friendly (no Date objects · no BigInt · no
 *     Map/Set/Symbol) so deterministic canonicalization (§5.6) is round-trip-stable.
 *   - **CL-Activity-2** — `kind` is a sealed Schema.TaggedEnum with a WorldDefined seam.
 *   - **CL-Activity-3** — the per-kind period_key correctness is enforced INSIDE the ActivityKind
 *     union (each variant declares its own period_key shape). The outer `period_key: PeriodKey`
 *     here is the wire-shape projection — the matching contract is documented + tested.
 *   - **CL-Activity-4** — lifecycle_state values are a sealed literal union. State-machine
 *     enforcement of legal transitions lives in `packages/engine/lifecycle.ts` (T2.7), not here.
 */
export const ActivityLifecycleState = Schema.Literal(
  "DEFINED",
  "ACTIVE",
  "PARTICIPATING",
  "COMPLETED",
  "EXPIRED",
);

export type ActivityLifecycleState = Schema.Schema.Type<typeof ActivityLifecycleState>;

export const Activity = Schema.Struct({
  id: ActivityId,
  kind: ActivityKind,
  period_key: Schema.NullOr(PeriodKey),
  steps: Schema.Array(ActivityStep),
  reward: ActivityReward,
  reward_state_id: Schema.NullOr(EventId),
  completion_event_schema: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(512),
    Schema.pattern(/^https?:\/\/[^\s]+$/),
  ),
  world: Schema.NullOr(WorldId),
  schema_version: Schema.Literal("1.0.0"),
  lifecycle_state: ActivityLifecycleState,
  $id: Schema.Literal("https://schemas.freeside.thj/activity/v1.0.0"),
});

export type Activity = Schema.Schema.Type<typeof Activity>;
