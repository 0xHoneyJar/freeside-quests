/**
 * Auth + pagination module for the freeside-activities protocol
 * (T1.16 + T1.17 + T1.18 + T1.19 · per PRD §FR-9 + SDD §Fix-A3 + §Fix-A4 + §6).
 *
 * Modules:
 *   - BearerToken    → MCPBearerToken (Fix-A3 · CL-Auth-1..5)
 *   - WorldScope     → sealed RBAC scope (Fix-A4 · CL-Scope-1..5)
 *   - Cursor         → tamper-resistant pagination (D22 · CL-MCP-4)
 *   - PayloadLimits  → WorldDefined size + nesting bounds (D26)
 */

export {
  MCPBearerToken,
  TOKEN_KEY_DISCOVERY_ENDPOINT,
  TOKEN_REPLAY_WINDOW_SECONDS,
  TOKEN_SKEW_TOLERANCE_SECONDS,
} from "./BearerToken.js";
export {
  Cursor,
  CursorError,
  CursorPayload,
  ExpiredCursor,
  InvalidCursor,
  paginatedResponse,
} from "./Cursor.js";
export {
  __internalPayloadHelpers,
  WORLD_PAYLOAD_MAX_BYTES,
  WORLD_PAYLOAD_MAX_DEPTH,
  WorldDefinedPayload,
} from "./PayloadLimits.js";
export {
  AuditPermission,
  MCPToolPermission,
  WorldScope,
  WorldScopeAudit,
  WorldScopeMulti,
  WorldScopeSingle,
} from "./WorldScope.js";
