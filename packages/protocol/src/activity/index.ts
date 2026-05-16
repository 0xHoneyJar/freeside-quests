/**
 * Activity substrate exports for the freeside-activities protocol.
 *
 * Sealed-schema authorities (FR-1 + FR-2 · architectural lock A1):
 *   - Activity              — the supertype struct (FR-1)
 *   - ActivityKind          — the sealed TaggedEnum with WorldDefined seam (FR-2)
 *   - ActivityLifecycleState - the 5-state lifecycle (DEFINED→ACTIVE→...) (CL-Activity-4)
 *   - ActivityStep          - minimal scaffold (T1.5 lands the full schema)
 *   - ActivityReward        - minimal scaffold (T1.6 lands the full sealed-enum)
 *
 * Namespace-governance helpers (D19 · §9.1):
 *   - WorldDefinedKindId    — substrate-validated `<world_id>:<kind>` shape
 *   - WorldSubSchemaId      — URI shape for world-supplied sub_schema_id
 *   - RESERVED_KIND_PREFIXES - prefixes the substrate reserves for itself
 */

export {
  Activity,
  ActivityLifecycleState,
} from "./Activity.js";
export {
  ActivityKind,
  RESERVED_KIND_PREFIXES,
  WorldDefinedKindId,
  WorldSubSchemaId,
} from "./ActivityKind.js";
export { ActivityReward } from "./ActivityReward.js";
export { ActivityStep } from "./ActivityStep.js";
