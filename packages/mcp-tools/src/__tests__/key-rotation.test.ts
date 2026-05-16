/**
 * IMP-005 (T1.16 + T2.11 amendment) — key rotation tests.
 *
 * Acceptance per sprint plan §12.4:
 *   - kid mid-rotation (active key works)
 *   - expired key rejected
 *   - revoked key rejected
 *   - active + grace overlap window works
 */
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  IdentityId,
  type KeyState,
  RFC3339Date,
  WorldId,
  WorldScopeSingle,
} from "@0xhoneyjar/quests-protocol";

import {
  makeInMemoryJTIReplayTracker,
  makeKeyProviderSignatureVerifier,
  validateBearerToken,
} from "../auth/bearer-token.js";
import { makeInMemoryKeyProvider } from "../auth/in-memory-key-provider.js";

const decode = Schema.decodeUnknownSync;
const callerA = decode(IdentityId)("id_a");
const worldFoo = decode(WorldId)("world_foo");

const toRFC = (s: string) => decode(RFC3339Date)(s);
const isoMinus = (deltaSec: number) =>
  toRFC(new Date(Date.now() - deltaSec * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"));
const isoPlus = (deltaSec: number) =>
  toRFC(new Date(Date.now() + deltaSec * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"));

const activeKey: KeyState = {
  kid: "kid-active",
  key_material_hex: "ab".repeat(32),
  state: "active",
  state_since: isoMinus(3600),
  expires_at: isoPlus(86400),
};

const graceKey: KeyState = {
  kid: "kid-grace",
  key_material_hex: "cd".repeat(32),
  state: "grace",
  state_since: isoMinus(600),
  expires_at: isoPlus(3600),
};

const expiredKey: KeyState = {
  kid: "kid-expired",
  key_material_hex: "ef".repeat(32),
  state: "active",
  state_since: isoMinus(7200),
  expires_at: isoMinus(60),
};

const revokedKey: KeyState = {
  kid: "kid-revoked",
  key_material_hex: "12".repeat(32),
  state: "revoked",
  state_since: isoMinus(300),
  expires_at: isoPlus(86400),
};

const tokenWith = (overrides: Partial<Record<string, unknown>> = {}) => ({
  alg: "Ed25519",
  typ: "freeside-mcp-token",
  kid: "kid-active",
  iss: worldFoo,
  sub: callerA,
  aud: ["freeside-activities"],
  exp: isoPlus(3600),
  iat: isoMinus(60),
  jti: `jti-${Math.random().toString(16).slice(2)}`,
  scope: WorldScopeSingle.make({ world_id: worldFoo }),
  permissions: ["getProgress"],
  signature: "a".repeat(128),
  ...overrides,
});

describe("IMP-005 — key rotation tests", () => {
  it("active kid resolves and the token validates", async () => {
    const provider = makeInMemoryKeyProvider({ keys: [activeKey] });
    const verifier = makeKeyProviderSignatureVerifier(provider);
    const raw = tokenWith({ kid: "kid-active" });
    const result = await Effect.runPromise(
      validateBearerToken(
        { raw, requestedTool: "getProgress", requestedWorld: worldFoo },
        { signatureVerifier: verifier, replayTracker: makeInMemoryJTIReplayTracker() },
      ),
    );
    expect(result.token.kid).toBe("kid-active");
  });

  it("grace-period kid still resolves (active + grace overlap window works)", async () => {
    const provider = makeInMemoryKeyProvider({ keys: [activeKey, graceKey] });
    const verifier = makeKeyProviderSignatureVerifier(provider);
    const raw = tokenWith({ kid: "kid-grace" });
    const result = await Effect.runPromise(
      validateBearerToken(
        { raw, requestedTool: "getProgress", requestedWorld: worldFoo },
        { signatureVerifier: verifier, replayTracker: makeInMemoryJTIReplayTracker() },
      ),
    );
    expect(result.token.kid).toBe("kid-grace");
  });

  it("expired key kid rejected with TokenSignatureInvalid", async () => {
    const provider = makeInMemoryKeyProvider({ keys: [expiredKey] });
    const verifier = makeKeyProviderSignatureVerifier(provider);
    const raw = tokenWith({ kid: "kid-expired" });
    const failure = await Effect.runPromise(
      Effect.flip(
        validateBearerToken(
          { raw, requestedTool: "getProgress", requestedWorld: worldFoo },
          { signatureVerifier: verifier, replayTracker: makeInMemoryJTIReplayTracker() },
        ),
      ),
    );
    expect(failure._tag).toBe("TokenSignatureInvalid");
    if (failure._tag === "TokenSignatureInvalid") {
      expect(failure.reason).toContain("expired");
    }
  });

  it("revoked key kid rejected with TokenSignatureInvalid", async () => {
    const provider = makeInMemoryKeyProvider({ keys: [revokedKey] });
    const verifier = makeKeyProviderSignatureVerifier(provider);
    const raw = tokenWith({ kid: "kid-revoked" });
    const failure = await Effect.runPromise(
      Effect.flip(
        validateBearerToken(
          { raw, requestedTool: "getProgress", requestedWorld: worldFoo },
          { signatureVerifier: verifier, replayTracker: makeInMemoryJTIReplayTracker() },
        ),
      ),
    );
    expect(failure._tag).toBe("TokenSignatureInvalid");
    if (failure._tag === "TokenSignatureInvalid") {
      expect(failure.reason).toContain("revoked");
    }
  });

  it("unknown kid rejected with TokenSignatureInvalid (kid not found)", async () => {
    const provider = makeInMemoryKeyProvider({ keys: [activeKey] });
    const verifier = makeKeyProviderSignatureVerifier(provider);
    const raw = tokenWith({ kid: "kid-unknown" });
    const failure = await Effect.runPromise(
      Effect.flip(
        validateBearerToken(
          { raw, requestedTool: "getProgress", requestedWorld: worldFoo },
          { signatureVerifier: verifier, replayTracker: makeInMemoryJTIReplayTracker() },
        ),
      ),
    );
    expect(failure._tag).toBe("TokenSignatureInvalid");
    if (failure._tag === "TokenSignatureInvalid") {
      expect(failure.reason).toContain("not found");
    }
  });

  it("provider unavailable rejected with TokenSignatureInvalid (provider unavailable)", async () => {
    const provider = makeInMemoryKeyProvider({
      keys: [activeKey],
      forceUnavailable: "JWKS-fetch-timeout",
    });
    const verifier = makeKeyProviderSignatureVerifier(provider);
    const raw = tokenWith({ kid: "kid-active" });
    const failure = await Effect.runPromise(
      Effect.flip(
        validateBearerToken(
          { raw, requestedTool: "getProgress", requestedWorld: worldFoo },
          { signatureVerifier: verifier, replayTracker: makeInMemoryJTIReplayTracker() },
        ),
      ),
    );
    expect(failure._tag).toBe("TokenSignatureInvalid");
    if (failure._tag === "TokenSignatureInvalid") {
      expect(failure.reason).toContain("provider unavailable");
    }
  });

  it("listActiveKids returns active + grace kids (NOT revoked)", async () => {
    const provider = makeInMemoryKeyProvider({
      keys: [activeKey, graceKey, revokedKey],
    });
    const result = await Effect.runPromise(provider.listActiveKids());
    const kids = result.map((k) => k.kid);
    expect(kids).toContain("kid-active");
    expect(kids).toContain("kid-grace");
    expect(kids).not.toContain("kid-revoked");
  });

  it("integration: signature callback receives the resolved key_material_hex", async () => {
    const provider = makeInMemoryKeyProvider({ keys: [activeKey] });
    let receivedKey: string | null = null;
    const verifier = makeKeyProviderSignatureVerifier(
      provider,
      (_, keyMaterial) => {
        receivedKey = keyMaterial;
        return Effect.succeed(true);
      },
    );
    const raw = tokenWith({ kid: "kid-active" });
    await Effect.runPromise(
      validateBearerToken(
        { raw, requestedTool: "getProgress", requestedWorld: worldFoo },
        { signatureVerifier: verifier, replayTracker: makeInMemoryJTIReplayTracker() },
      ),
    );
    expect(receivedKey).toBe(activeKey.key_material_hex);
  });
});
