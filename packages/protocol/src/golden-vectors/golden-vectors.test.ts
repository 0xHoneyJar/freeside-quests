import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { canonicalizeJCS } from "../encoding/jcs.js";
import { computeEventIdSync } from "../events/compute-event-id.js";
import {
  ActivityCompletedPreimage,
  BadgeIssuedPreimage,
  ProgressAdvancedPreimage,
  RaffleDrawnPreimage,
  RewardFailedPreimage,
  RewardGrantedPreimage,
  RewardPendingPreimage,
} from "../preimage/index.js";
import {
  ACTIVITY_COMPLETED_VECTORS,
  BADGE_ISSUED_VECTORS,
  type GoldenVector,
  PROGRESS_ADVANCED_VECTORS,
  RAFFLE_DRAWN_VECTORS,
  REWARD_FAILED_VECTORS,
  REWARD_GRANTED_VECTORS,
  REWARD_PENDING_VECTORS,
} from "./index.js";

/**
 * Strip event_id + canonical-sort step_completions, mirroring
 * computeEventId's preimage extraction. Tests use this to assert the
 * preimage_jcs golden bytes.
 */
const buildPreimageJcs = (event: Record<string, unknown>): string => {
  const { event_id: _drop, ...rest } = event;
  const preimage = rest as Record<string, unknown>;
  const stepsKey =
    "step_completions" in preimage
      ? "step_completions"
      : "new_step_completions" in preimage
        ? "new_step_completions"
        : null;
  if (stepsKey && Array.isArray(preimage[stepsKey])) {
    const sorted = [...(preimage[stepsKey] as unknown[])].sort((a: unknown, b: unknown) => {
      const ao = (a as { order?: number }).order ?? 0;
      const bo = (b as { order?: number }).order ?? 0;
      if (ao !== bo) return ao - bo;
      const aid = String((a as { step_id?: unknown }).step_id ?? "");
      const bid = String((b as { step_id?: unknown }).step_id ?? "");
      return aid < bid ? -1 : aid > bid ? 1 : 0;
    });
    return canonicalizeJCS({ ...preimage, [stepsKey]: sorted });
  }
  return canonicalizeJCS(preimage);
};

interface VectorGroup<A> {
  readonly name: string;
  readonly preimageSchema: Schema.Schema<A, unknown>;
  readonly vectors: ReadonlyArray<GoldenVector<unknown>>;
}

const ALL_GROUPS: ReadonlyArray<VectorGroup<unknown>> = [
  {
    name: "ActivityCompleted",
    preimageSchema: ActivityCompletedPreimage as never,
    vectors: ACTIVITY_COMPLETED_VECTORS as ReadonlyArray<GoldenVector<unknown>>,
  },
  {
    name: "BadgeIssued",
    preimageSchema: BadgeIssuedPreimage as never,
    vectors: BADGE_ISSUED_VECTORS as ReadonlyArray<GoldenVector<unknown>>,
  },
  {
    name: "RaffleDrawn",
    preimageSchema: RaffleDrawnPreimage as never,
    vectors: RAFFLE_DRAWN_VECTORS as ReadonlyArray<GoldenVector<unknown>>,
  },
  {
    name: "ProgressAdvanced",
    preimageSchema: ProgressAdvancedPreimage as never,
    vectors: PROGRESS_ADVANCED_VECTORS as ReadonlyArray<GoldenVector<unknown>>,
  },
  {
    name: "RewardPending",
    preimageSchema: RewardPendingPreimage as never,
    vectors: REWARD_PENDING_VECTORS as ReadonlyArray<GoldenVector<unknown>>,
  },
  {
    name: "RewardGranted",
    preimageSchema: RewardGrantedPreimage as never,
    vectors: REWARD_GRANTED_VECTORS as ReadonlyArray<GoldenVector<unknown>>,
  },
  {
    name: "RewardFailed",
    preimageSchema: RewardFailedPreimage as never,
    vectors: REWARD_FAILED_VECTORS as ReadonlyArray<GoldenVector<unknown>>,
  },
];

describe("golden vectors (T1.11 · §5.7 · cross-runtime determinism)", () => {
  it("ships exactly 21 fixtures (3 per event type × 7 event types)", () => {
    const total = ALL_GROUPS.reduce((acc, g) => acc + g.vectors.length, 0);
    expect(total).toBe(21);
    for (const group of ALL_GROUPS) {
      expect(group.vectors.length).toBe(3);
    }
  });

  it("uses unique expected_event_id for every fixture (no collisions)", () => {
    const allIds = ALL_GROUPS.flatMap((g) => g.vectors.map((v) => v.expected_event_id));
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  for (const group of ALL_GROUPS) {
    describe(`${group.name}`, () => {
      for (const vector of group.vectors) {
        describe(`${vector.label}`, () => {
          it("input is a valid event preimage (Schema decodes)", () => {
            // Decode the preimage (input without event_id) — this proves the
            // fixture's structural shape matches the per-event preimage Schema.
            const { event_id: _drop, ...preimage } = vector.input as Record<string, unknown>;
            expect(() => Schema.decodeUnknownSync(group.preimageSchema)(preimage)).not.toThrow();
          });

          it("computeEventId(input) matches expected_event_id (CL-Event-3)", async () => {
            const id = await computeEventIdSync(
              vector.input as Parameters<typeof computeEventIdSync>[0],
            );
            expect(id).toBe(vector.expected_event_id);
          });

          it("canonical preimage JCS matches expected_preimage_jcs (§5.6)", () => {
            const jcs = buildPreimageJcs(vector.input as Record<string, unknown>);
            expect(jcs).toBe(vector.expected_preimage_jcs);
          });

          it("is deterministic across 10 invocations (CL-Event-3)", async () => {
            const ref = await computeEventIdSync(
              vector.input as Parameters<typeof computeEventIdSync>[0],
            );
            for (let i = 0; i < 10; i++) {
              const again = await computeEventIdSync(
                vector.input as Parameters<typeof computeEventIdSync>[0],
              );
              expect(again).toBe(ref);
            }
          });
        });
      }
    });
  }
});
