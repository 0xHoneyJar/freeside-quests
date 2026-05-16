/**
 * T2.11 acceptance — bearer-token validator + RBAC + replay tracker.
 */
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  IdentityId,
  WorldId,
  WorldScopeAudit,
  WorldScopeMulti,
  WorldScopeSingle,
} from "@0xhoneyjar/quests-protocol";

import {
  makeInMemoryJTIReplayTracker,
  validateBearerToken,
} from "../auth/bearer-token.js";

const decode = Schema.decodeUnknownSync;
const callerA = decode(IdentityId)("id_caller");
const worldFoo = decode(WorldId)("world_foo");
const worldBar = decode(WorldId)("world_bar");

// Helper: build a valid (well-formed) token. Tests mutate fields to trigger
// specific failure paths.
const validToken = (overrides: Partial<Record<string, unknown>> = {}) => {
  const iat = new Date(Date.now() - 60 * 1000).toISOString();
  const exp = new Date(Date.now() + 3600 * 1000).toISOString();
  return {
    alg: "Ed25519",
    typ: "freeside-mcp-token",
    kid: "test-kid-1",
    iss: worldFoo,
    sub: callerA,
    aud: ["freeside-activities"],
    exp,
    iat,
    jti: `jti-${Math.random().toString(16).slice(2)}`,
    scope: WorldScopeSingle.make({ world_id: worldFoo }),
    permissions: ["getActiveActivities", "getProgress"],
    signature: "a".repeat(128),
    ...overrides,
  };
};

const trackerFor = () => makeInMemoryJTIReplayTracker(3600);

describe("validateBearerToken", () => {
  describe("schema rejection (Fix-A3 / Fix-A4)", () => {
    it("rejects alg:none with TokenSchemaInvalid", async () => {
      const raw = validToken({ alg: "none" });
      const failure = await Effect.runPromise(
        Effect.flip(
          validateBearerToken(
            { raw, requestedTool: "getProgress", requestedWorld: worldFoo },
            { replayTracker: trackerFor() },
          ),
        ),
      );
      expect(failure._tag).toBe("TokenSchemaInvalid");
    });

    it("rejects alg:HS256 with TokenSchemaInvalid", async () => {
      const raw = validToken({ alg: "HS256" });
      const failure = await Effect.runPromise(
        Effect.flip(
          validateBearerToken(
            { raw, requestedTool: "getProgress", requestedWorld: worldFoo },
            { replayTracker: trackerFor() },
          ),
        ),
      );
      expect(failure._tag).toBe("TokenSchemaInvalid");
    });

    it("rejects wrong typ", async () => {
      const raw = validToken({ typ: "JWT" });
      const failure = await Effect.runPromise(
        Effect.flip(
          validateBearerToken(
            { raw, requestedTool: "getProgress", requestedWorld: worldFoo },
            { replayTracker: trackerFor() },
          ),
        ),
      );
      expect(failure._tag).toBe("TokenSchemaInvalid");
    });
  });

  describe("happy path", () => {
    it("validates well-formed token and returns parsed shape", async () => {
      const raw = validToken();
      const result = await Effect.runPromise(
        validateBearerToken(
          { raw, requestedTool: "getProgress", requestedWorld: worldFoo },
          { replayTracker: trackerFor() },
        ),
      );
      expect(result.caller_identity).toBe(callerA);
      expect(result.world_scope._tag).toBe("single");
    });
  });

  describe("time bounds", () => {
    it("rejects expired token with TokenExpired", async () => {
      const past = new Date(Date.now() - 10_000).toISOString();
      const raw = validToken({ exp: past });
      const failure = await Effect.runPromise(
        Effect.flip(
          validateBearerToken(
            { raw, requestedTool: "getProgress", requestedWorld: worldFoo },
            { replayTracker: trackerFor() },
          ),
        ),
      );
      expect(failure._tag).toBe("TokenExpired");
    });
  });

  describe("world scope (Fix-A4)", () => {
    it("rejects single-scope token requesting a different world", async () => {
      const raw = validToken({ scope: WorldScopeSingle.make({ world_id: worldFoo }) });
      const failure = await Effect.runPromise(
        Effect.flip(
          validateBearerToken(
            { raw, requestedTool: "getProgress", requestedWorld: worldBar },
            { replayTracker: trackerFor() },
          ),
        ),
      );
      expect(failure._tag).toBe("WorldScopeDenied");
    });

    it("accepts multi-scope token containing the requested world", async () => {
      const raw = validToken({
        scope: WorldScopeMulti.make({ world_ids: [worldFoo, worldBar] }),
      });
      const result = await Effect.runPromise(
        validateBearerToken(
          { raw, requestedTool: "getProgress", requestedWorld: worldBar },
          { replayTracker: trackerFor() },
        ),
      );
      expect(result.token.scope._tag).toBe("multi");
    });

    it("rejects multi-scope token without world_ids match", async () => {
      const raw = validToken({
        scope: WorldScopeMulti.make({ world_ids: [worldFoo] }),
      });
      const failure = await Effect.runPromise(
        Effect.flip(
          validateBearerToken(
            { raw, requestedTool: "getProgress", requestedWorld: worldBar },
            { replayTracker: trackerFor() },
          ),
        ),
      );
      expect(failure._tag).toBe("WorldScopeDenied");
    });

    it("accepts audit-scoped token requesting 'global'", async () => {
      const raw = validToken({
        scope: WorldScopeAudit.make({ permissions: ["audit-log-read"] }),
      });
      const result = await Effect.runPromise(
        validateBearerToken(
          { raw, requestedTool: "getProgress", requestedWorld: "global" },
          { replayTracker: trackerFor() },
        ),
      );
      expect(result.token.scope._tag).toBe("audit");
    });
  });

  describe("tool RBAC", () => {
    it("rejects request for tool not in permissions array", async () => {
      const raw = validToken({ permissions: ["getActiveActivities"] });
      const failure = await Effect.runPromise(
        Effect.flip(
          validateBearerToken(
            { raw, requestedTool: "getProgress", requestedWorld: worldFoo },
            { replayTracker: trackerFor() },
          ),
        ),
      );
      expect(failure._tag).toBe("PermissionDenied");
    });
  });

  describe("jti replay (CL-Auth-5)", () => {
    it("rejects duplicate jti within window", async () => {
      const tracker = trackerFor();
      const raw = validToken({ jti: "fixed-jti" });
      // first use ok
      await Effect.runPromise(
        validateBearerToken(
          { raw, requestedTool: "getProgress", requestedWorld: worldFoo },
          { replayTracker: tracker },
        ),
      );
      // second use within window rejected
      const failure = await Effect.runPromise(
        Effect.flip(
          validateBearerToken(
            { raw, requestedTool: "getProgress", requestedWorld: worldFoo },
            { replayTracker: tracker },
          ),
        ),
      );
      expect(failure._tag).toBe("ReplayDetected");
      if (failure._tag === "ReplayDetected") {
        expect(failure.jti).toBe("fixed-jti");
      }
    });

    it("permits different jti values from the same caller", async () => {
      const tracker = trackerFor();
      const raw1 = validToken({ jti: "jti-1" });
      const raw2 = validToken({ jti: "jti-2" });
      await Effect.runPromise(
        validateBearerToken(
          { raw: raw1, requestedTool: "getProgress", requestedWorld: worldFoo },
          { replayTracker: tracker },
        ),
      );
      const result = await Effect.runPromise(
        validateBearerToken(
          { raw: raw2, requestedTool: "getProgress", requestedWorld: worldFoo },
          { replayTracker: tracker },
        ),
      );
      expect(result.token.jti).toBe("jti-2");
      expect(tracker.size()).toBe(2);
    });
  });
});

describe("makeInMemoryJTIReplayTracker", () => {
  it("records fresh jti and rejects duplicates within window", () => {
    const tracker = makeInMemoryJTIReplayTracker(3600);
    const a = tracker.record("jti-a", 1_000_000);
    expect(a.fresh).toBe(true);
    const aAgain = tracker.record("jti-a", 1_000_001);
    expect(aAgain.fresh).toBe(false);
    expect(aAgain.first_seen_unix_ms).toBe(1_000_000);
  });

  it("GCs entries older than window on next insert", () => {
    const tracker = makeInMemoryJTIReplayTracker(60); // 60s window
    tracker.record("jti-a", 0);
    tracker.record("jti-b", 30_000);
    // 70s later, both should be GC'd before new insert
    const fresh = tracker.record("jti-c", 100_000);
    expect(fresh.fresh).toBe(true);
    expect(tracker.size()).toBe(1);
  });
});
