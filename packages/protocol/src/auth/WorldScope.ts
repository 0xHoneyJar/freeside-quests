import { Schema } from "effect";

import { WorldId } from "../branded/WorldId.js";

/**
 * WorldScope — replaces the removed 'global' scope (Fix-A4 · CL-Scope-1..5
 * · per SDD §Fix-A4).
 *
 * Variants:
 *   - Single  → tenant-scoped · default · world_id required (CL-Scope-1)
 *   - Multi   → explicit cross-world enumeration · world_ids list required
 *               (operator-issued only · CL-Scope-2)
 *   - Audit   → read-only-audit scope (CL-Scope-3) · cannot access live
 *               participation/badge/raffle data · permissions array specifies
 *               which audit endpoints are reachable
 *
 * The 'global' scope is REMOVED. Multi-tenant access MUST enumerate the
 * specific world_ids the token is authorized for; cross-world enumeration
 * (CL-Scope-4) requires explicit per-tool permission claim (deny-by-default
 * per CL-Scope-5).
 */
export const WorldScopeSingle = Schema.TaggedStruct("single", {
  world_id: WorldId,
});

export const WorldScopeMulti = Schema.TaggedStruct("multi", {
  world_ids: Schema.Array(WorldId).pipe(Schema.minItems(1), Schema.maxItems(32)),
});

export const AuditPermission = Schema.Literal("audit-log-read", "audit-log-aggregate");

export type AuditPermission = Schema.Schema.Type<typeof AuditPermission>;

export const WorldScopeAudit = Schema.TaggedStruct("audit", {
  permissions: Schema.Array(AuditPermission).pipe(Schema.minItems(1)),
});

export const WorldScope = Schema.Union(WorldScopeSingle, WorldScopeMulti, WorldScopeAudit);

export type WorldScope = Schema.Schema.Type<typeof WorldScope>;

/**
 * MCPToolPermission — the 5 read-only MCP tools each token may grant (FR-9).
 * `permissions` claim in MCPBearerToken explicitly enumerates which tools
 * the holder can invoke.
 */
export const MCPToolPermission = Schema.Literal(
  "getActiveActivities",
  "getProgress",
  "getBadges",
  "getRaffleEntries",
  "listKinds",
);

export type MCPToolPermission = Schema.Schema.Type<typeof MCPToolPermission>;
