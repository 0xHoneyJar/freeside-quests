/**
 * T2.14 acceptance — cursor sign+verify · roundtrip stable · tampered cursor
 * → InvalidCursor · expired cursor → ExpiredCursor.
 */
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { type CursorPayload, IdentityId, RFC3339Date, WorldId } from "@0xhoneyjar/quests-protocol";

import {
  decodeCursor,
  encodeCursor,
  makeInMemoryCursorSigner,
  signCursor,
  verifyCursor,
} from "../pagination/cursor.js";

const decode = Schema.decodeUnknownSync;
const callerA = decode(IdentityId)("id_caller");
const worldFoo = decode(WorldId)("world_foo");

const toRFC = (s: string) => decode(RFC3339Date)(s);

const samplePayload = (overrides: Partial<Record<string, unknown>> = {}): CursorPayload =>
  ({
    world_scope: worldFoo,
    caller_identity: callerA,
    tool: "getProgress",
    filters_hash: "a".repeat(64),
    expires_at: toRFC(new Date(Date.now() + 60_000).toISOString().replace(/\.\d{3}Z$/, "Z")),
    page_position: "page-1",
    ...overrides,
  }) as CursorPayload;

describe("cursor sign + verify pipeline (T2.14)", () => {
  it("signs a cursor and roundtrips successfully", async () => {
    const signer = makeInMemoryCursorSigner();
    const payload = samplePayload();
    const cursor = await Effect.runPromise(signCursor(payload, signer));
    const encoded = encodeCursor(cursor);
    const verified = await Effect.runPromise(verifyCursor(encoded, { signer }));
    expect(verified.caller_identity).toBe(callerA);
    expect(verified.page_position).toBe("page-1");
  });

  it("signature is byte-stable across two signs of the same payload", async () => {
    const signer = makeInMemoryCursorSigner();
    const payload = samplePayload({
      expires_at: toRFC("2026-06-16T00:00:00Z"),
      page_position: "stable-test",
    });
    const c1 = await Effect.runPromise(signCursor(payload, signer));
    const c2 = await Effect.runPromise(signCursor(payload, signer));
    expect(c1.signature).toBe(c2.signature);
  });

  it("rejects a tampered cursor with InvalidCursor", async () => {
    const signer = makeInMemoryCursorSigner();
    const payload = samplePayload();
    const cursor = await Effect.runPromise(signCursor(payload, signer));
    // Tamper with the page_position — signature no longer matches canonical preimage
    const tampered = encodeCursor({
      ...cursor,
      payload: { ...cursor.payload, page_position: "evil-page" },
    });
    const failure = await Effect.runPromise(
      Effect.flip(verifyCursor(tampered, { signer })),
    );
    expect(failure._tag).toBe("InvalidCursor");
  });

  it("rejects an expired cursor with ExpiredCursor", async () => {
    const signer = makeInMemoryCursorSigner();
    const expired = samplePayload({
      expires_at: toRFC(new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z")),
    });
    const cursor = await Effect.runPromise(signCursor(expired, signer));
    const encoded = encodeCursor(cursor);
    const failure = await Effect.runPromise(
      Effect.flip(verifyCursor(encoded, { signer })),
    );
    expect(failure._tag).toBe("ExpiredCursor");
  });

  it("rejects malformed base64url with InvalidCursor", async () => {
    const signer = makeInMemoryCursorSigner();
    const failure = await Effect.runPromise(
      Effect.flip(verifyCursor("not-base64url-!!!", { signer })),
    );
    expect(failure._tag).toBe("InvalidCursor");
  });

  it("decodeCursor parses base64url + schema validates shape", async () => {
    const signer = makeInMemoryCursorSigner();
    const cursor = await Effect.runPromise(signCursor(samplePayload(), signer));
    const decoded = await Effect.runPromise(decodeCursor(encodeCursor(cursor)));
    expect(decoded.payload.caller_identity).toBe(callerA);
    expect(decoded.signature).toMatch(/^[a-f0-9]{128}$/);
  });

  it("two different signers produce different signatures (secret-dependent)", async () => {
    const signerA = makeInMemoryCursorSigner({ secret: "secret-a" });
    const signerB = makeInMemoryCursorSigner({ secret: "secret-b" });
    const payload = samplePayload({
      expires_at: toRFC("2026-06-16T00:00:00Z"),
      page_position: "secret-test",
    });
    const cA = await Effect.runPromise(signCursor(payload, signerA));
    const cB = await Effect.runPromise(signCursor(payload, signerB));
    expect(cA.signature).not.toBe(cB.signature);
  });
});
