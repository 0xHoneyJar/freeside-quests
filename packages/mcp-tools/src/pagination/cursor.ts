/**
 * Pagination cursor sign + verify (T2.14 · D22 + D17).
 *
 * Cursors carry routing context (caller · tool · filters_hash · world_scope ·
 * page_position) signed by the gateway. Adapters verify on receipt and
 * trust the payload. This module implements the canonical pipeline against
 * the protocol's {@link Cursor} schema.
 *
 * The signature implementation here is a deterministic in-memory HMAC for
 * test fixtures. Production gateways plug in an Ed25519 signer (the protocol
 * pins signature length to Ed25519's 128 hex chars; the in-memory signer
 * matches that surface so downstream code doesn't see a different shape).
 */
import { Data, Effect, Schema } from "effect";

import {
  Cursor,
  type CursorError,
  type CursorPayload,
  CursorPayload as CursorPayloadSchema,
  ExpiredCursor,
  InvalidCursor,
} from "@0xhoneyjar/quests-protocol";

/** Type-name aliases for InvalidCursor's runtime shape (Schema.TaggedStruct value · type via Schema.Type). */
type InvalidCursorT = Schema.Schema.Type<typeof InvalidCursor>;

export class SigningKeyUnavailable extends Data.TaggedError("SigningKeyUnavailable")<{
  readonly reason: string;
}> {}

export type CursorPipelineError = CursorError | SigningKeyUnavailable;

/**
 * Pluggable signer interface. Production wraps an Ed25519 private key;
 * the in-memory test signer wraps a deterministic HMAC.
 */
export interface CursorSigner {
  readonly sign: (payload: CursorPayload) => Effect.Effect<string, SigningKeyUnavailable>;
  readonly verify: (
    payload: CursorPayload,
    signature: string,
  ) => Effect.Effect<true, SigningKeyUnavailable | InvalidCursorT>;
}

/**
 * Deterministic in-memory signer using SHA-256 over a canonical payload
 * encoding + a static "test-secret" key. NOT for production. Produces
 * the protocol's 128-hex-char shape so downstream Schema validation passes.
 */
export const makeInMemoryCursorSigner = (
  config: { readonly secret?: string } = {},
): CursorSigner => {
  const secret = config.secret ?? "in-memory-test-secret";

  const sign = async (payload: CursorPayload): Promise<string> => {
    const canonical = JSON.stringify({
      world_scope: payload.world_scope,
      caller_identity: payload.caller_identity,
      tool: payload.tool,
      filters_hash: payload.filters_hash,
      expires_at: payload.expires_at,
      page_position: payload.page_position,
    });
    const message = `${secret}::${canonical}`;
    const encoded = new TextEncoder().encode(message);
    const hash = await crypto.subtle.digest("SHA-256", encoded);
    // SHA-256 produces 32 bytes / 64 hex; protocol pins to 128 hex (Ed25519).
    // Double-hash + concatenate to reach 128 hex chars for shape compliance.
    const second = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${message}::round-2`));
    const bytes1 = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const bytes2 = Array.from(new Uint8Array(second))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return bytes1 + bytes2;
  };

  return {
    sign: (payload) => Effect.tryPromise({
      try: () => sign(payload),
      catch: (err) =>
        new SigningKeyUnavailable({
          reason: err instanceof Error ? err.message : String(err),
        }),
    }),
    verify: (payload, signature) =>
      Effect.gen(function* () {
        const expected = yield* Effect.tryPromise({
          try: () => sign(payload),
          catch: (err) =>
            new SigningKeyUnavailable({
              reason: err instanceof Error ? err.message : String(err),
            }),
        });
        if (expected !== signature) {
          return yield* Effect.fail(
            InvalidCursor.make({ reason: "signature does not match canonical payload" }),
          );
        }
        return true as const;
      }),
  };
};

/**
 * Encodes a cursor (payload + signature) into a transport-safe base64url
 * string for over-the-wire delivery.
 */
export const encodeCursor = (cursor: Cursor): string => {
  const json = JSON.stringify(cursor);
  return Buffer.from(json, "utf8").toString("base64url");
};

/**
 * Decodes a base64url cursor and parses it through the {@link Cursor}
 * Schema. Returns the parsed shape or fails with InvalidCursor for
 * malformed input.
 */
export const decodeCursor = (
  raw: string,
): Effect.Effect<Cursor, InvalidCursorT> =>
  Effect.gen(function* () {
    const json = yield* Effect.try({
      try: () => Buffer.from(raw, "base64url").toString("utf8"),
      catch: () => InvalidCursor.make({ reason: "base64url decode failed" }),
    });
    const parsed = yield* Effect.try({
      try: () => JSON.parse(json) as unknown,
      catch: () => InvalidCursor.make({ reason: "JSON parse failed" }),
    });
    return yield* Effect.try({
      try: () => Schema.decodeUnknownSync(Cursor)(parsed),
      catch: (err) =>
        InvalidCursor.make({
          reason: err instanceof Error ? err.message : "schema decode failed",
        }),
    });
  });

/**
 * Full verify pipeline: decode → signature verify → expiry check.
 * Returns the parsed payload on success; fails with InvalidCursor /
 * ExpiredCursor / SigningKeyUnavailable on rejection.
 */
export interface VerifyCursorConfig {
  readonly signer: CursorSigner;
  readonly nowProvider?: () => string;
}

export const verifyCursor = (
  raw: string,
  config: VerifyCursorConfig,
): Effect.Effect<CursorPayload, CursorPipelineError> =>
  Effect.gen(function* () {
    const cursor = yield* decodeCursor(raw);
    yield* config.signer.verify(cursor.payload, cursor.signature);
    const now = (config.nowProvider ?? (() => new Date().toISOString()))();
    if (Date.parse(cursor.payload.expires_at) <= Date.parse(now)) {
      return yield* Effect.fail(
        ExpiredCursor.make({ expired_at: cursor.payload.expires_at }),
      );
    }
    return cursor.payload;
  });

/**
 * Builds a signed cursor from a payload. Convenience wrapper that signs
 * then re-validates the resulting Cursor through the schema (defense in
 * depth for shape drift).
 */
export const signCursor = (
  payload: CursorPayload,
  signer: CursorSigner,
): Effect.Effect<Cursor, SigningKeyUnavailable | InvalidCursorT> =>
  Effect.gen(function* () {
    // Re-validate payload through schema before signing — defense for
    // hand-built fixtures that may miss invariants.
    const validatedPayload = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(CursorPayloadSchema)(payload),
      catch: (err) =>
        InvalidCursor.make({
          reason: err instanceof Error ? err.message : "payload schema decode failed",
        }),
    });
    const signature = yield* signer.sign(validatedPayload);
    return yield* Effect.try({
      try: () => Schema.decodeUnknownSync(Cursor)({ payload: validatedPayload, signature }),
      catch: (err) =>
        InvalidCursor.make({
          reason: err instanceof Error ? err.message : "cursor schema decode failed",
        }),
    });
  });

/**
 * Helper: returns the canonical PaginatedResponse<T> Schema for tool
 * outputs. D17 RESOLVED via the protocol's paginatedResponse helper —
 * re-exported here for adapter convenience.
 */
export { paginatedResponse } from "@0xhoneyjar/quests-protocol";
