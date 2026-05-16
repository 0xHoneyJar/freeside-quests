import { Schema } from "effect";

import { CycleId } from "./CycleId.js";
import { SnapshotId } from "./SnapshotId.js";

/**
 * ISO-week period anchor — RFC 8601 week format `YYYY-Www` (per FR-2 Mission).
 *
 * Pattern: 4-digit year · "-W" · 2-digit week 01-53. Tied to ActivityKind.Mission.
 */
export const ISOWeek = Schema.String.pipe(
  Schema.pattern(/^\d{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$/),
  Schema.brand("ISOWeek"),
);

export type ISOWeek = Schema.Schema.Type<typeof ISOWeek>;

/**
 * WorldDefinedKey — world-supplied period key value (escape-hatch case).
 *
 * For ActivityKind.WorldDefined, the world chooses the period_key shape;
 * substrate only enforces it is a non-empty string ≤256 chars.
 */
export const WorldDefinedKey = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(256),
  Schema.brand("WorldDefinedKey"),
);

export type WorldDefinedKey = Schema.Schema.Type<typeof WorldDefinedKey>;

/**
 * PeriodKey — union of every legal period-anchor shape (per SDD §3.1).
 *
 * The variant is determined by the host ActivityKind:
 *   - Quest                → null
 *   - Mission              → ISOWeek
 *   - BadgeClaim           → null | SnapshotId
 *   - RaffleEntry          → CycleId
 *   - WorldDefined         → null | WorldDefinedKey
 *
 * The per-kind correctness contract (CL-Activity-3 · CL-ActivityKind-2) is
 * enforced by the ActivityKind sealed union itself; PeriodKey here is the
 * outer wire-shape used by `Activity.period_key`.
 */
export const PeriodKey = Schema.Union(Schema.Null, ISOWeek, SnapshotId, CycleId, WorldDefinedKey);

export type PeriodKey = Schema.Schema.Type<typeof PeriodKey>;
