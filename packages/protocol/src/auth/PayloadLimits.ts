import { Schema } from "effect";

/**
 * WorldDefined payload limits (T1.19 · D26 RESOLVED).
 *
 * Substrate enforces these bounds on the OPAQUE payload of WorldDefined
 * activities + events to prevent:
 *   - DoS via mega-payloads (memory + serialization-time amplification)
 *   - Pathological nesting (parser stack overflow)
 *
 * Worlds carrying larger payloads MUST split them across multiple events
 * OR store off-chain with the event referencing by URI.
 */

/** Maximum serialized payload size in bytes (≈16 KiB). */
export const WORLD_PAYLOAD_MAX_BYTES = 16 * 1024;

/** Maximum nesting depth (object-in-object or array-in-array). */
export const WORLD_PAYLOAD_MAX_DEPTH = 8;

/**
 * Computes the nesting depth of a JSON-shaped value.
 * Leaf values (string, number, boolean, null) have depth 0.
 * Empty containers have depth 1.
 */
const valueDepth = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value !== "object") return 0;
  if (Array.isArray(value)) {
    if (value.length === 0) return 1;
    let maxChild = 0;
    for (const item of value) {
      const d = valueDepth(item);
      if (d > maxChild) maxChild = d;
    }
    return 1 + maxChild;
  }
  // Plain object
  const keys = Object.keys(value);
  if (keys.length === 0) return 1;
  let maxChild = 0;
  for (const key of keys) {
    const d = valueDepth((value as Record<string, unknown>)[key]);
    if (d > maxChild) maxChild = d;
  }
  return 1 + maxChild;
};

/**
 * Serialized byte-size of a value via JSON.stringify (canonical for
 * size-limit checks). Returns Infinity if stringify would throw (cyclic
 * reference, BigInt, etc.) so it sorts above any finite bound.
 */
const valueByteSize = (value: unknown): number => {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return Number.POSITIVE_INFINITY;
    return new TextEncoder().encode(json).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

/**
 * WorldDefinedPayload — Schema for the opaque world-supplied payload.
 *
 * The shape itself is `unknown` (the world owns the substructure) but
 * substrate enforces:
 *   1. Serialized size ≤ {@link WORLD_PAYLOAD_MAX_BYTES}
 *   2. Nesting depth ≤ {@link WORLD_PAYLOAD_MAX_DEPTH}
 *
 * Both checks return descriptive error messages for the ParseResult.
 */
export const WorldDefinedPayload = Schema.Unknown.pipe(
  Schema.filter(
    (value) => {
      const bytes = valueByteSize(value);
      if (bytes > WORLD_PAYLOAD_MAX_BYTES) {
        return `WorldDefined payload size ${bytes}B exceeds WORLD_PAYLOAD_MAX_BYTES (${WORLD_PAYLOAD_MAX_BYTES}B)`;
      }
      const depth = valueDepth(value);
      if (depth > WORLD_PAYLOAD_MAX_DEPTH) {
        return `WorldDefined payload depth ${depth} exceeds WORLD_PAYLOAD_MAX_DEPTH (${WORLD_PAYLOAD_MAX_DEPTH})`;
      }
      return undefined;
    },
    { identifier: "WorldDefinedPayload" },
  ),
);

export type WorldDefinedPayload = Schema.Schema.Type<typeof WorldDefinedPayload>;

/** Exposed for testing + adapter-internal pre-checks (NOT a contract surface). */
export const __internalPayloadHelpers = {
  valueDepth,
  valueByteSize,
};
