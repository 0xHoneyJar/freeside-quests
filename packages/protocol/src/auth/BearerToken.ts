import { Schema } from "effect";

import { IdentityId } from "../branded/IdentityId.js";
import { WorldId } from "../branded/WorldId.js";
import { RFC3339Date } from "../encoding/date.js";
import { MCPToolPermission, WorldScope } from "./WorldScope.js";

/**
 * Cross-runtime constants for MCP bearer-token validation
 * (Fix-A3 + Fix-A4 · CL-Auth-1..5 · per SDD §Fix-A3).
 *
 * Adapters MUST enforce all of these — these constants are part of the
 * public contract.
 */

/** CL-Auth-3 · ±60s tolerance for `iat` skew. */
export const TOKEN_SKEW_TOLERANCE_SECONDS = 60;

/**
 * CL-Auth-4 · key discovery endpoint path for JWKS. Adapters fetch the
 * JWKS document from this path on the issuing world's host; cache for 5 min.
 */
export const TOKEN_KEY_DISCOVERY_ENDPOINT = "/.well-known/freeside-mcp-jwks";

/**
 * CL-Auth-5 · jti replay window. Adapters MUST track seen jti for at least
 * this many seconds and reject duplicates with `ReplayDetected`.
 */
export const TOKEN_REPLAY_WINDOW_SECONDS = 3600; // 1 hour

/**
 * MCPBearerToken — the canonical bearer token schema (Fix-A3 · CL-Auth-1..5).
 *
 * Notable invariants:
 *   - **alg** is `Schema.Literal('Ed25519')` (CL-Auth-1) — alg:none and HS256
 *     are rejected at the schema boundary (NOT runtime check).
 *   - **kid** carries the key id for rotation (CL-Auth-4 supports rotation
 *     without invalidating existing tokens).
 *   - **typ** pins to 'freeside-mcp-token' (CL-Auth-2 — JSON-canonical envelope,
 *     NOT JWT compact form, avoids alg-confusion attacks).
 *   - **scope** is the {@link WorldScope} sealed union (Fix-A4) — `single` /
 *     `multi` / `audit`.
 *   - **permissions** explicitly enumerates allowed MCP tools (deny-by-default
 *     per CL-Scope-5).
 *   - **signature** is hex-encoded Ed25519 over the canonical token payload.
 */
export const MCPBearerToken = Schema.Struct({
  // Header
  alg: Schema.Literal("Ed25519"),
  typ: Schema.Literal("freeside-mcp-token"),
  kid: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),

  // Required claims
  iss: WorldId,
  sub: IdentityId,
  aud: Schema.Array(Schema.Literal("freeside-activities")).pipe(
    Schema.minItems(1),
    Schema.maxItems(8),
  ),
  exp: RFC3339Date,
  iat: RFC3339Date,
  jti: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),

  // freeside-specific claims
  scope: WorldScope,
  permissions: Schema.Array(MCPToolPermission),

  // Signature over canonical token-without-signature
  signature: Schema.String.pipe(
    Schema.pattern(/^[a-f0-9]{128}$/), // Ed25519 → 64 bytes → 128 hex chars
  ),
});

export type MCPBearerToken = Schema.Schema.Type<typeof MCPBearerToken>;
