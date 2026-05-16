import { Schema } from "effect";

import { IdentityId } from "../branded/IdentityId.js";
import { WorldId } from "../branded/WorldId.js";
import { RFC3339Date } from "../encoding/date.js";

/**
 * Cursor — tamper-resistant pagination token (T1.18 · D22 RESOLVED).
 *
 * Carries the page-position fingerprint PLUS the binding context (caller +
 * tool + filter set) so a cursor copied across users / tools / queries is
 * rejected. Signed payload prevents tampering.
 *
 * Shape:
 *   - `world_scope` snapshot at issue time
 *   - `caller_identity` (token sub)
 *   - `tool` (MCP tool name)
 *   - `filters_hash` (sha256 of canonical filter JSON · query is part of the binding)
 *   - `expires_at` (RFC3339 · TTL)
 *   - `page_position` (opaque adapter-supplied)
 *   - `signature` (hex Ed25519)
 *
 * Adapters MUST reject:
 *   - mismatched signature → InvalidCursor (T1.18 acceptance)
 *   - expired cursors → Expired
 *   - caller mismatch → InvalidCursor
 *   - tool mismatch → InvalidCursor
 *   - filters_hash mismatch → InvalidCursor
 */
export const CursorPayload = Schema.Struct({
  world_scope: Schema.Union(WorldId, Schema.Literal("multi"), Schema.Literal("audit")),
  caller_identity: IdentityId,
  tool: Schema.Literal(
    "getActiveActivities",
    "getProgress",
    "getBadges",
    "getRaffleEntries",
    "listKinds",
  ),
  filters_hash: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
  expires_at: RFC3339Date,
  page_position: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),
});

export type CursorPayload = Schema.Schema.Type<typeof CursorPayload>;

/**
 * Cursor — the over-the-wire shape (payload + signature). Adapters
 * deserialize, verify the signature against their issuing key, then
 * trust the payload fields for routing.
 */
export const Cursor = Schema.Struct({
  payload: CursorPayload,
  signature: Schema.String.pipe(
    Schema.pattern(/^[a-f0-9]{128}$/), // Ed25519
  ),
});

export type Cursor = Schema.Schema.Type<typeof Cursor>;

/**
 * CursorError — sealed TaggedStruct union for cursor verification failures
 * (T1.18 · per acceptance criteria).
 */
export const InvalidCursor = Schema.TaggedStruct("InvalidCursor", {
  reason: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),
});

export const ExpiredCursor = Schema.TaggedStruct("ExpiredCursor", {
  expired_at: RFC3339Date,
});

export const CursorError = Schema.Union(InvalidCursor, ExpiredCursor);

export type CursorError = Schema.Schema.Type<typeof CursorError>;

/**
 * PaginatedResponse — generic envelope every list MCP tool returns
 * (FR-9 · CL-MCP-4 · cursor-based pagination).
 *
 * Callers receive `items` + `next_cursor` (null when exhausted).
 */
export const paginatedResponse = <A, I>(itemSchema: Schema.Schema<A, I>) =>
  Schema.Struct({
    items: Schema.Array(itemSchema),
    next_cursor: Schema.NullOr(Cursor),
    schema_version: Schema.Literal("1.0.0"),
  });
