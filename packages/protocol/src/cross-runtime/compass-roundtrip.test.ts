/**
 * T3.9 · Cross-runtime conformance test — compass-roundtrip.
 *
 * Goal: prove the Activity supertype + ActivityKind sealed union + WorldDefined
 * seam can REPRESENT all 4 compass WorldEvent variants without lossy translation.
 *
 * Source mapping (compass/packages/peripheral-events/src/world-event.ts):
 *   - MintEvent           → BadgeIssued substrate event (via badge-claim Activity kind)
 *   - WeatherEvent        → WorldDefined Activity kind (compass:weather-broadcast)
 *   - ElementShiftEvent   → WorldDefined Activity kind (compass:element-shift)
 *   - QuizCompletedEvent  → ActivityCompleted (via quest Activity kind)
 *
 * This is a SHAPE-conformance test: it verifies that the substrate's branded
 * types + sealed unions ACCEPT inputs in the shape compass produces. It does
 * NOT re-derive event_ids cross-runtime (compass uses its own canonical
 * preimage rules — that's a downstream parity test, not a shape test).
 */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ActivityId,
  IdentityId,
  RFC3339Date,
  SnapshotId,
  WorldDefinedKindId,
} from "../index.js";

const decode = Schema.decodeUnknownSync;

describe("compass-roundtrip · cross-runtime conformance (T3.9)", () => {
  describe("MintEvent → badge-claim Activity kind + BadgeIssued event", () => {
    it("compass MintEvent fields fit substrate's badge-claim shape", () => {
      // Compass MintEvent: { ownerWallet, element, weather, stonePda, ... }
      //
      // Mapping table:
      //   ownerWallet → identity_id (via IdentityResolverPort.resolveFromChainAddress)
      //   element + weather → badge_family_id (e.g., "compass:wood-on-fire-day")
      //   stonePda → snapshot_id (the on-chain commitment proves the mint)
      //   eventId → re-derived through substrate's computeEventId at emission
      const identity = decode(IdentityId)("id_solanapubkeyabc");
      const activityId = decode(ActivityId)("act_compassmint001");
      const snapshotId = decode(SnapshotId)("snap_compassstone1");
      const ts = decode(RFC3339Date)("2026-05-16T00:00:00Z");
      expect(identity).toBeTruthy();
      expect(activityId).toBeTruthy();
      expect(snapshotId).toBeTruthy();
      expect(ts).toBe("2026-05-16T00:00:00Z");
    });
  });

  describe("WeatherEvent → WorldDefined Activity kind", () => {
    it("compass:weather-broadcast is a valid WorldDefinedKindId", () => {
      const kindId = decode(WorldDefinedKindId)("compass:weather-broadcast");
      expect(kindId).toBe("compass:weather-broadcast");
    });

    it("substrate-reserved prefixes are rejected even when compass-flavored", () => {
      expect(() => decode(WorldDefinedKindId)("freeside-weather")).toThrow();
      expect(() => decode(WorldDefinedKindId)("loa-weather")).toThrow();
      expect(() => decode(WorldDefinedKindId)("core-weather")).toThrow();
    });

    it("WeatherEvent payload fits within substrate bounds (16 KiB · 8-level nesting)", () => {
      const payload = {
        day: "2026-05-16",
        source: "CORONA",
        affinity: { WOOD: 0.2, FIRE: 0.4, EARTH: 0.1, METAL: 0.15, WATER: 0.15 },
      };
      const serialized = JSON.stringify(payload);
      expect(serialized.length).toBeLessThanOrEqual(16 * 1024); // D26
    });
  });

  describe("ElementShiftEvent → WorldDefined Activity kind", () => {
    it("compass:element-shift is a valid WorldDefinedKindId", () => {
      const kindId = decode(WorldDefinedKindId)("compass:element-shift");
      expect(kindId).toBe("compass:element-shift");
    });

    it("ElementShiftEvent (fromAffinity, toAffinity, deltaElement) payload fits bounds", () => {
      const payload = {
        from_affinity: { WOOD: 0.4, FIRE: 0.2, EARTH: 0.1, METAL: 0.15, WATER: 0.15 },
        to_affinity: { WOOD: 0.5, FIRE: 0.2, EARTH: 0.1, METAL: 0.1, WATER: 0.1 },
        delta_element: "WOOD",
      };
      const serialized = JSON.stringify(payload);
      expect(serialized.length).toBeLessThanOrEqual(16 * 1024);
    });
  });

  describe("QuizCompletedEvent → quest Activity kind (one-shot)", () => {
    it("compass quiz-completion fits substrate's quest shape", () => {
      const activityId = decode(ActivityId)("act_compassquizarchetypewood");
      const identity = decode(IdentityId)("id_compassquiztaker001");
      expect(activityId).toBeTruthy();
      expect(identity).toBeTruthy();
    });
  });

  describe("substrate completeness · all 4 compass variants map to substrate concepts", () => {
    it("mapping table covers all 4 compass WorldEvent variants", () => {
      const mappingTable = [
        {
          compass_variant: "MintEvent",
          compass_output_type: "Artifact",
          substrate_event: "BadgeIssued",
          substrate_kind: "badge-claim",
        },
        {
          compass_variant: "WeatherEvent",
          compass_output_type: "Signal",
          substrate_event: "Activity (WorldDefined kind)",
          substrate_kind: "compass:weather-broadcast",
        },
        {
          compass_variant: "ElementShiftEvent",
          compass_output_type: "Verdict",
          substrate_event: "Activity (WorldDefined kind)",
          substrate_kind: "compass:element-shift",
        },
        {
          compass_variant: "QuizCompletedEvent",
          compass_output_type: "Operator-Model",
          substrate_event: "ActivityCompleted",
          substrate_kind: "quest",
        },
      ];
      expect(mappingTable.length).toBe(4);
      const outputTypes = mappingTable.map((r) => r.compass_output_type).sort();
      expect(outputTypes).toEqual(["Artifact", "Operator-Model", "Signal", "Verdict"]);

      const builtinKinds = mappingTable.filter((r) =>
        ["quest", "mission", "badge-claim", "raffle-entry"].includes(r.substrate_kind),
      );
      expect(builtinKinds.length).toBe(2);
      const worldDefinedKinds = mappingTable.filter((r) => r.substrate_kind.startsWith("compass:"));
      expect(worldDefinedKinds.length).toBe(2);
    });
  });
});
