/**
 * Beacon renderer — reads `packages/protocol/beacon.yaml` (the BeaconV3
 * building-identity declaration) and renders it to JSON for
 * `GET /.well-known/beacon.json` (SDD §5 · FR-A1).
 *
 * Parsing uses Bun's builtin `Bun.YAML.parse` — zero added dependencies.
 *
 * The 5 declared READ capabilities (`capabilities[]` in the YAML) are the
 * G-2 min-capability gate (SDD §12.7 / IMP-011): the registry only flips
 * `not-built → deployed` when the beacon serves with all 5 capabilities
 * resolving. This module exposes `capabilities()` so the runtime can assert
 * non-empty at boot and the health/registry checks can read them.
 *
 * NOTE on placeholder hashes: the YAML ships PLACEHOLDER sealed_schema hashes
 * (64 zeros) + composes_with tags. `freeside-cli doctor` (FR-A4, a separate
 * Lane-A task) recomputes them at deploy time. This renderer serves the file
 * VERBATIM — it does NOT compute hashes. Serving the authored shape is correct
 * for the read plane; doctor's recompute is the deploy-time bind.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The beacon.yaml lives in the protocol package. From `apps/runtime/src/` the
 * relative path is `../../packages/protocol/beacon.yaml`. A `BEACON_YAML_PATH`
 * env override lets a container point at a copied beacon (the Dockerfile copies
 * the repo, so the relative path resolves there too — the override is a safety
 * valve, not a requirement).
 */
export const beaconYamlPath = (
  env: Record<string, string | undefined> = process.env,
): string =>
  env.BEACON_YAML_PATH ??
  join(HERE, "..", "..", "..", "packages", "protocol", "beacon.yaml");

export interface RenderedBeacon {
  readonly json: Record<string, unknown>;
  readonly capabilities: ReadonlyArray<string>;
}

/**
 * Render the beacon YAML to a JSON object once and cache it (the file is
 * immutable for the life of the process). Throws only if the file is missing
 * or unparseable — a deploy-time misconfiguration the operator must fix, not a
 * per-request failure mode.
 */
let cached: RenderedBeacon | undefined;

export const renderBeacon = (
  env: Record<string, string | undefined> = process.env,
): RenderedBeacon => {
  if (cached !== undefined) return cached;

  const path = beaconYamlPath(env);
  const raw = Bun.file(path);
  // Bun.file(...).text() is async; we read sync via readFileSync to keep the
  // renderer usable from a synchronous boot assertion.
  const text = require("node:fs").readFileSync(path, "utf8") as string;
  if (typeof text !== "string" || text.length === 0) {
    throw new Error(`beacon.yaml empty or unreadable at ${path} (${raw.name})`);
  }

  const parsed = Bun.YAML.parse(text) as Record<string, unknown>;
  const caps = Array.isArray(parsed.capabilities)
    ? (parsed.capabilities as unknown[]).filter(
        (c): c is string => typeof c === "string",
      )
    : [];

  cached = { json: parsed, capabilities: caps };
  return cached;
};

/** The declared read capabilities (5 expected). */
export const beaconCapabilities = (
  env: Record<string, string | undefined> = process.env,
): ReadonlyArray<string> => renderBeacon(env).capabilities;

/** The minimum-required capability set (SDD §12.7 / IMP-011 G-2 sharpening). */
export const REQUIRED_CAPABILITIES: ReadonlyArray<string> = [
  "get-active-activities",
  "get-progress",
  "get-badges",
  "get-raffle-entries",
  "list-kinds",
];

/**
 * Assert the beacon resolves with the full required capability set. Returns a
 * structured result the boot path logs (and a future registry-flip check can
 * consume) — does NOT throw, so a beacon drift is observable rather than fatal.
 */
export const checkCapabilities = (
  env: Record<string, string | undefined> = process.env,
): { ok: boolean; resolved: ReadonlyArray<string>; missing: ReadonlyArray<string> } => {
  const resolved = beaconCapabilities(env);
  const missing = REQUIRED_CAPABILITIES.filter((c) => !resolved.includes(c));
  return { ok: missing.length === 0, resolved, missing };
};
