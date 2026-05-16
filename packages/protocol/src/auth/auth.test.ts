import { Either, ParseResult, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  __internalPayloadHelpers,
  Cursor,
  CursorError,
  MCPBearerToken,
  paginatedResponse,
  TOKEN_KEY_DISCOVERY_ENDPOINT,
  TOKEN_REPLAY_WINDOW_SECONDS,
  TOKEN_SKEW_TOLERANCE_SECONDS,
  WORLD_PAYLOAD_MAX_BYTES,
  WORLD_PAYLOAD_MAX_DEPTH,
  WorldDefinedPayload,
  WorldScope,
} from "./index.js";

const expectFail = <A, I>(schema: Schema.Schema<A, I>, input: unknown) => {
  const result = Schema.decodeUnknownEither(schema)(input);
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isLeft(result)) {
    expect(ParseResult.isParseError(result.left)).toBe(true);
  }
};

const VALID_TS = "2026-05-15T12:00:00Z";
const VALID_SIG_128 = "a".repeat(128);
const VALID_HASH_64 = "b".repeat(64);

describe("WorldScope (T1.17 · Fix-A4 · CL-Scope-1..5)", () => {
  it("decodes single-world scope (default tenant case)", () => {
    const v = Schema.decodeUnknownSync(WorldScope)({
      _tag: "single",
      world_id: "world_mongolian",
    });
    expect(v._tag).toBe("single");
  });

  it("decodes multi-world scope with explicit list (CL-Scope-1)", () => {
    const v = Schema.decodeUnknownSync(WorldScope)({
      _tag: "multi",
      world_ids: ["world_a", "world_b"],
    });
    expect(v._tag).toBe("multi");
  });

  it("rejects multi-world scope with empty list (CL-Scope-1)", () => {
    expectFail(WorldScope, { _tag: "multi", world_ids: [] });
  });

  it("rejects 'global' scope (CL-Scope-1 · explicitly REMOVED)", () => {
    expectFail(WorldScope, { _tag: "global" });
  });

  it("decodes audit scope with permissions", () => {
    const v = Schema.decodeUnknownSync(WorldScope)({
      _tag: "audit",
      permissions: ["audit-log-read"],
    });
    expect(v._tag).toBe("audit");
  });

  it("rejects audit scope with empty permissions (CL-Scope-3)", () => {
    expectFail(WorldScope, { _tag: "audit", permissions: [] });
  });

  it("rejects audit scope with unknown permission value", () => {
    expectFail(WorldScope, {
      _tag: "audit",
      permissions: ["delete-everything"],
    });
  });
});

describe("MCPBearerToken (T1.16 · Fix-A3 · CL-Auth-1..5)", () => {
  const validToken = {
    alg: "Ed25519" as const,
    typ: "freeside-mcp-token" as const,
    kid: "world-mongolian-key-1",
    iss: "world_mongolian",
    sub: "id_player1",
    aud: ["freeside-activities" as const],
    exp: "2026-05-15T13:00:00Z",
    iat: VALID_TS,
    jti: "tok_unique_abc123",
    scope: { _tag: "single" as const, world_id: "world_mongolian" },
    permissions: ["getActiveActivities" as const, "getProgress" as const],
    signature: VALID_SIG_128,
  };

  it("decodes a canonical token (golden)", () => {
    const v = Schema.decodeUnknownSync(MCPBearerToken)(validToken);
    expect(v.alg).toBe("Ed25519");
  });

  it("rejects alg:none (CL-Auth-1 · NO alg:none)", () => {
    expectFail(MCPBearerToken, { ...validToken, alg: "none" });
  });

  it("rejects HS256 (CL-Auth-1 · Ed25519 only)", () => {
    expectFail(MCPBearerToken, { ...validToken, alg: "HS256" });
  });

  it("rejects RS256 (CL-Auth-1 · Ed25519 only)", () => {
    expectFail(MCPBearerToken, { ...validToken, alg: "RS256" });
  });

  it("rejects unknown typ (CL-Auth-2 · pin typ)", () => {
    expectFail(MCPBearerToken, { ...validToken, typ: "jwt" });
  });

  it("rejects empty aud", () => {
    expectFail(MCPBearerToken, { ...validToken, aud: [] });
  });

  it("rejects signature of wrong length", () => {
    expectFail(MCPBearerToken, {
      ...validToken,
      signature: "a".repeat(127),
    });
  });

  it("rejects signature with uppercase hex", () => {
    expectFail(MCPBearerToken, {
      ...validToken,
      signature: "A".repeat(128),
    });
  });

  it("rejects unknown permission grant", () => {
    expectFail(MCPBearerToken, {
      ...validToken,
      permissions: ["dropDatabase"],
    });
  });

  it("rejects malformed exp (non-RFC3339)", () => {
    expectFail(MCPBearerToken, { ...validToken, exp: "tomorrow" });
  });

  it("constants are stable parts of the contract", () => {
    expect(TOKEN_SKEW_TOLERANCE_SECONDS).toBe(60);
    expect(TOKEN_KEY_DISCOVERY_ENDPOINT).toBe("/.well-known/freeside-mcp-jwks");
    expect(TOKEN_REPLAY_WINDOW_SECONDS).toBe(3600);
  });
});

describe("Cursor (T1.18 · D22 tamper-resistance)", () => {
  const validCursor = {
    payload: {
      world_scope: "world_mongolian",
      caller_identity: "id_player1",
      tool: "getProgress" as const,
      filters_hash: VALID_HASH_64,
      expires_at: "2026-05-15T13:00:00Z",
      page_position: "page-2-offset-50",
    },
    signature: VALID_SIG_128,
  };

  it("decodes a canonical cursor", () => {
    const v = Schema.decodeUnknownSync(Cursor)(validCursor);
    expect(v.payload.tool).toBe("getProgress");
  });

  it("rejects cursor with non-64-hex filters_hash", () => {
    expectFail(Cursor, {
      ...validCursor,
      payload: { ...validCursor.payload, filters_hash: "short" },
    });
  });

  it("rejects cursor with unknown tool name", () => {
    expectFail(Cursor, {
      ...validCursor,
      payload: { ...validCursor.payload, tool: "deleteWorld" },
    });
  });

  it("rejects cursor with malformed signature", () => {
    expectFail(Cursor, { ...validCursor, signature: "abc" });
  });

  it("CursorError InvalidCursor decodes with reason", () => {
    const v = Schema.decodeUnknownSync(CursorError)({
      _tag: "InvalidCursor",
      reason: "signature mismatch",
    });
    expect(v._tag).toBe("InvalidCursor");
  });

  it("CursorError ExpiredCursor decodes with expired_at", () => {
    const v = Schema.decodeUnknownSync(CursorError)({
      _tag: "ExpiredCursor",
      expired_at: VALID_TS,
    });
    expect(v._tag).toBe("ExpiredCursor");
  });

  it("paginatedResponse wraps items + next_cursor (FR-9 CL-MCP-4)", () => {
    const itemSchema = Schema.Struct({ id: Schema.String });
    const response = paginatedResponse(itemSchema);
    const v = Schema.decodeUnknownSync(response)({
      items: [{ id: "a" }, { id: "b" }],
      next_cursor: validCursor,
      schema_version: "1.0.0",
    });
    expect(v.items.length).toBe(2);
    expect(v.next_cursor).not.toBeNull();
  });

  it("paginatedResponse accepts null next_cursor (exhausted)", () => {
    const itemSchema = Schema.Struct({ id: Schema.String });
    const response = paginatedResponse(itemSchema);
    const v = Schema.decodeUnknownSync(response)({
      items: [],
      next_cursor: null,
      schema_version: "1.0.0",
    });
    expect(v.next_cursor).toBeNull();
  });
});

describe("WorldDefinedPayload (T1.19 · D26)", () => {
  const { valueByteSize, valueDepth } = __internalPayloadHelpers;

  it("constants documented (CL contracts)", () => {
    expect(WORLD_PAYLOAD_MAX_BYTES).toBe(16 * 1024);
    expect(WORLD_PAYLOAD_MAX_DEPTH).toBe(8);
  });

  it("accepts a small flat payload", () => {
    const v = Schema.decodeUnknownSync(WorldDefinedPayload)({
      key: "value",
      n: 42,
    });
    expect(v).toBeDefined();
  });

  it("rejects payload > 16 KiB", () => {
    const big = "x".repeat(17 * 1024);
    expectFail(WorldDefinedPayload, { data: big });
  });

  it("rejects payload deeper than 8 levels", () => {
    let nested: Record<string, unknown> = { leaf: 0 };
    for (let i = 0; i < 10; i++) {
      nested = { next: nested };
    }
    expectFail(WorldDefinedPayload, nested);
  });

  it("accepts payload at exactly 8 levels deep (boundary)", () => {
    let nested: Record<string, unknown> = { leaf: 0 };
    for (let i = 0; i < 7; i++) {
      nested = { next: nested };
    } // depth = 8 (leaf=0, +7 wraps, +1 outer object that gets passed in)
    const v = Schema.decodeUnknownSync(WorldDefinedPayload)(nested);
    expect(v).toBeDefined();
  });

  it("internal helpers: valueDepth + valueByteSize round-trip", () => {
    expect(valueDepth({ a: 1 })).toBe(1);
    expect(valueDepth({ a: { b: 1 } })).toBe(2);
    expect(valueDepth([1, 2, 3])).toBe(1);
    expect(valueDepth([[1]])).toBe(2);
    expect(valueDepth("string")).toBe(0);
    expect(valueDepth(42)).toBe(0);
    expect(valueDepth(null)).toBe(0);

    expect(valueByteSize({})).toBe(2); // "{}"
    expect(valueByteSize({ a: 1 })).toBeGreaterThan(0);
  });
});
