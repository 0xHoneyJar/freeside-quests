/**
 * Bearer-token validator (T2.11 · FR-9 · Fix-A3 + Fix-A4 + D21).
 *
 * The substrate validates 5 invariants on every token:
 *   1. Schema decode: rejects alg:none, alg:HS*, wrong typ, missing claims.
 *      The {@link MCPBearerToken} schema literal-pins alg=Ed25519, typ=
 *      "freeside-mcp-token", aud must include "freeside-activities".
 *   2. Time bounds: iat <= now+skew, exp > now (RFC 3339 comparison).
 *   3. World-scope filter: token's scope must contain the requested world
 *      OR be audit-scoped for audit-* permissions.
 *   4. Tool RBAC: requested tool must be in token.permissions (deny-by-default).
 *   5. jti replay: tracked in a 3600-second sliding window. Duplicate jti
 *      within the window ⇒ ReplayDetected (CL-Auth-5).
 *
 * Signature verification is OUT OF SCOPE for the in-memory adapter — the
 * production gateway plugs in JWKS resolution at the
 * TOKEN_KEY_DISCOVERY_ENDPOINT and verifies Ed25519 there. This module
 * publishes the verifier interface so worlds can drop in their JWKS
 * adapter while reusing the rest of the pipeline.
 */
import { Data, Effect, Schema } from "effect";

import {
  type KeyProviderError,
  type KeyProviderPort,
  type MCPBearerToken,
  type MCPToolPermission,
  TOKEN_REPLAY_WINDOW_SECONDS,
  TOKEN_SKEW_TOLERANCE_SECONDS,
  type WorldId,
  type WorldScope,
} from "@0xhoneyjar/quests-protocol";
import { MCPBearerToken as MCPBearerTokenSchema } from "@0xhoneyjar/quests-protocol";

// ---------------------------------------------------------------------------
// Error variants (sealed)
// ---------------------------------------------------------------------------

export class TokenSchemaInvalid extends Data.TaggedError("TokenSchemaInvalid")<{
  readonly detail: string;
}> {}

export class TokenExpired extends Data.TaggedError("TokenExpired")<{
  readonly exp: string;
  readonly now: string;
}> {}

export class TokenNotYetValid extends Data.TaggedError("TokenNotYetValid")<{
  readonly iat: string;
  readonly now: string;
}> {}

export class TokenSignatureInvalid extends Data.TaggedError("TokenSignatureInvalid")<{
  readonly kid: string;
  readonly reason: string;
}> {}

export class WorldScopeDenied extends Data.TaggedError("WorldScopeDenied")<{
  readonly requested_world: WorldId;
  readonly token_scope_tag: WorldScope["_tag"];
}> {}

export class PermissionDenied extends Data.TaggedError("PermissionDenied")<{
  readonly requested_tool: MCPToolPermission;
  readonly granted: ReadonlyArray<MCPToolPermission>;
}> {}

export class ReplayDetected extends Data.TaggedError("ReplayDetected")<{
  readonly jti: string;
  readonly first_seen: string;
}> {}

export type BearerTokenError =
  | TokenSchemaInvalid
  | TokenExpired
  | TokenNotYetValid
  | TokenSignatureInvalid
  | WorldScopeDenied
  | PermissionDenied
  | ReplayDetected;

// ---------------------------------------------------------------------------
// Signature verifier seam (pluggable)
// ---------------------------------------------------------------------------

/**
 * SignatureVerifier — production worlds inject a JWKS-backed Ed25519
 * verifier here. The in-memory test fixture defaults to "always valid"
 * unless a verifier is supplied. This SHOULD NOT be the production default.
 */
export interface SignatureVerifier {
  readonly verify: (token: MCPBearerToken) => Effect.Effect<true, TokenSignatureInvalid>;
}

export const acceptAllSignatureVerifier: SignatureVerifier = {
  verify: () => Effect.succeed(true as const),
};

/**
 * makeKeyProviderSignatureVerifier — composes a {@link KeyProviderPort}
 * (sprint-2 review C2 · Fix-S4 + IMP-005) with the validator pipeline.
 *
 * Behavior:
 *   - `KidNotFound` → TokenSignatureInvalid with reason "kid not found"
 *   - `KeyExpired` → TokenSignatureInvalid with reason "key expired"
 *   - `KeyRevoked` → TokenSignatureInvalid with reason "key revoked"
 *   - `KeyProviderUnavailable` → TokenSignatureInvalid with reason "provider unavailable"
 *
 * Once a kid resolves to a usable key (active OR grace), the verifier
 * delegates the actual signature check to the supplied `verify` callback.
 * The callback is where production drops in real Ed25519 against the
 * resolved `key_material_hex`. Tests default to "trust the key state" —
 * useful for asserting rotation flow without standing up real crypto.
 */
export const makeKeyProviderSignatureVerifier = (
  provider: KeyProviderPort,
  verify: (
    token: MCPBearerToken,
    key_material_hex: string,
  ) => Effect.Effect<boolean, never> = () => Effect.succeed(true),
): SignatureVerifier => ({
  verify: (token) =>
    Effect.gen(function* () {
      const outcome = yield* provider.resolveKey(token.kid).pipe(Effect.either);
      if (outcome._tag === "Left") {
        return yield* Effect.fail(translateKeyProviderError(token.kid, outcome.left));
      }
      const keyState = outcome.right;
      // active + grace both produce usable keys; revoked is filtered earlier
      // by the port itself (it returns KeyRevoked rather than a usable KeyState).
      const ok = yield* verify(token, keyState.key_material_hex);
      if (!ok) {
        return yield* Effect.fail(
          new TokenSignatureInvalid({ kid: token.kid, reason: "signature mismatch" }),
        );
      }
      return true as const;
    }),
});

const translateKeyProviderError = (
  kid: string,
  err: KeyProviderError,
): TokenSignatureInvalid => {
  switch (err._tag) {
    case "KidNotFound":
      return new TokenSignatureInvalid({ kid, reason: "kid not found" });
    case "KeyExpired":
      return new TokenSignatureInvalid({ kid, reason: `key expired at ${err.expired_at}` });
    case "KeyRevoked":
      return new TokenSignatureInvalid({ kid, reason: `key revoked at ${err.revoked_at}` });
    case "KeyProviderUnavailable":
      return new TokenSignatureInvalid({ kid, reason: `provider unavailable: ${err.reason}` });
  }
};

// ---------------------------------------------------------------------------
// Replay tracker (in-memory test fixture · production uses AuthReplayStore)
// ---------------------------------------------------------------------------

interface ReplayEntry {
  readonly jti: string;
  readonly first_seen_unix_ms: number;
}

/**
 * In-memory jti replay tracker (TEST FIXTURE / DEV-ONLY).
 *
 * Per sprint-plan §12.3 Fix-S6:
 *   - (a) bounded LRU with explicit memory cap (default 10000 jtis OR
 *     1-hour TTL whichever first)
 *   - (b) cold-start = reject-all-until-window-elapses when configured
 *     (NOT persisted by default)
 *   - (c) production interface defined: `AuthReplayStore` port
 *     (`@0xhoneyjar/quests-protocol`) — production Redis SETEX consumes it
 *
 * The "size" return on `record` is for observability; the LRU cap is
 * enforced by evicting the oldest insertion-order entry when full.
 * JS Map preserves insertion order, so the first key in the keys() iterator
 * is the LRU.
 */
export interface JTIReplayTracker {
  readonly record: (
    jti: string,
    nowMs: number,
  ) => { readonly fresh: boolean; readonly first_seen_unix_ms: number };
  readonly size: () => number;
}

export interface InMemoryJTIReplayTrackerConfig {
  /** Replay window in seconds. Default: TOKEN_REPLAY_WINDOW_SECONDS (3600). */
  readonly windowSeconds?: number;
  /** Memory cap. Default: 10000 jtis (per Fix-S6). LRU eviction when exceeded. */
  readonly maxEntries?: number;
  /**
   * Wall-clock instant when cold-start posture lifts. While `now < coldStartUntilMs`,
   * EVERY record() returns `{ fresh: false }` — paranoid mode for fresh deploys.
   * Omit / undefined = no cold-start posture (default; accept the first
   * observation of every jti).
   */
  readonly coldStartUntilMs?: number;
}

export const makeInMemoryJTIReplayTracker = (
  configOrWindow: InMemoryJTIReplayTrackerConfig | number = {},
): JTIReplayTracker => {
  // Legacy callsite compatibility: positional number is windowSeconds.
  const config: InMemoryJTIReplayTrackerConfig =
    typeof configOrWindow === "number" ? { windowSeconds: configOrWindow } : configOrWindow;
  const windowMs = (config.windowSeconds ?? TOKEN_REPLAY_WINDOW_SECONDS) * 1000;
  const maxEntries = config.maxEntries ?? 10_000;
  const coldStartUntilMs = config.coldStartUntilMs;
  const seen = new Map<string, ReplayEntry>();

  const gc = (nowMs: number): void => {
    for (const [jti, entry] of seen) {
      if (entry.first_seen_unix_ms + windowMs < nowMs) {
        seen.delete(jti);
      }
    }
  };

  const evictLRU = (): void => {
    // Iteration over a JS Map yields keys in insertion order — the first
    // key is the LRU. Evict one at a time so insertion-order semantics hold.
    while (seen.size >= maxEntries) {
      const oldest = seen.keys().next().value;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
  };

  return {
    record: (jti, nowMs) => {
      // Cold-start posture: reject every jti until the window lifts.
      if (coldStartUntilMs !== undefined && nowMs < coldStartUntilMs) {
        return { fresh: false, first_seen_unix_ms: nowMs };
      }
      gc(nowMs);
      const existing = seen.get(jti);
      if (existing !== undefined) {
        return { fresh: false, first_seen_unix_ms: existing.first_seen_unix_ms };
      }
      // Enforce memory cap BEFORE inserting (Fix-S6 bounded LRU).
      evictLRU();
      const entry: ReplayEntry = { jti, first_seen_unix_ms: nowMs };
      seen.set(jti, entry);
      return { fresh: true, first_seen_unix_ms: nowMs };
    },
    size: () => seen.size,
  };
};

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

const parseRFC3339ToUnixMs = (value: string): number => {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(`invalid RFC3339 date: ${value}`);
  }
  return ms;
};

export interface ValidatorConfig {
  readonly signatureVerifier?: SignatureVerifier;
  readonly replayTracker: JTIReplayTracker;
  readonly nowProvider?: () => string;
  /** Skew tolerance for iat check, seconds. Defaults to protocol constant. */
  readonly skewToleranceSeconds?: number;
}

export interface ValidateInput {
  readonly raw: unknown;
  readonly requestedTool: MCPToolPermission;
  readonly requestedWorld: WorldId | "global";
}

export interface ValidateSuccess {
  readonly token: MCPBearerToken;
  readonly caller_identity: MCPBearerToken["sub"];
  readonly world_scope: WorldScope;
}

const checkWorldScope = (
  scope: WorldScope,
  requested: WorldId | "global",
): boolean => {
  if (requested === "global") {
    // "global" only flows for audit-scope callers
    return scope._tag === "audit";
  }
  if (scope._tag === "single") {
    return scope.world_id === requested;
  }
  if (scope._tag === "multi") {
    return scope.world_ids.includes(requested);
  }
  // audit scope — explicitly opted into "global" reads, NOT per-world.
  return false;
};

/**
 * validateBearerToken — the canonical token validator (T2.11 · FR-9 + D21).
 *
 * Returns the parsed token + caller identity + world scope on success; fails
 * with one of the {@link BearerTokenError} variants on rejection.
 *
 * Per Fix-A3 / Fix-A4: alg:none and alg:HS* are rejected at the schema layer
 * (alg literal pinned to Ed25519). The validator is therefore safe to expose
 * even when the signature verifier is the accept-all default (for tests) —
 * malformed tokens never reach the verifier.
 */
export const validateBearerToken = (
  input: ValidateInput,
  config: ValidatorConfig,
): Effect.Effect<ValidateSuccess, BearerTokenError> =>
  Effect.gen(function* () {
    // 1. Schema decode (rejects alg:none, alg:HS*, missing claims)
    const decoded = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(MCPBearerTokenSchema)(input.raw),
      catch: (err) =>
        new TokenSchemaInvalid({
          detail: err instanceof Error ? err.message : String(err),
        }),
    });

    // 2. Signature verification
    const verifier = config.signatureVerifier ?? acceptAllSignatureVerifier;
    yield* verifier.verify(decoded);

    // 3. Time bounds
    const now = (config.nowProvider ?? (() => new Date().toISOString()))();
    const nowMs = parseRFC3339ToUnixMs(now);
    const expMs = parseRFC3339ToUnixMs(decoded.exp);
    if (expMs <= nowMs) {
      return yield* Effect.fail(new TokenExpired({ exp: decoded.exp, now }));
    }
    const iatMs = parseRFC3339ToUnixMs(decoded.iat);
    const skewMs = (config.skewToleranceSeconds ?? TOKEN_SKEW_TOLERANCE_SECONDS) * 1000;
    if (iatMs > nowMs + skewMs) {
      return yield* Effect.fail(new TokenNotYetValid({ iat: decoded.iat, now }));
    }

    // 4. World scope filter
    if (!checkWorldScope(decoded.scope, input.requestedWorld)) {
      return yield* Effect.fail(
        new WorldScopeDenied({
          requested_world: input.requestedWorld === "global" ? (input.requestedWorld as unknown as WorldId) : input.requestedWorld,
          token_scope_tag: decoded.scope._tag,
        }),
      );
    }

    // 5. Tool RBAC
    if (!decoded.permissions.includes(input.requestedTool)) {
      return yield* Effect.fail(
        new PermissionDenied({
          requested_tool: input.requestedTool,
          granted: decoded.permissions,
        }),
      );
    }

    // 6. jti replay
    const replay = config.replayTracker.record(decoded.jti, nowMs);
    if (!replay.fresh) {
      return yield* Effect.fail(
        new ReplayDetected({
          jti: decoded.jti,
          first_seen: new Date(replay.first_seen_unix_ms).toISOString(),
        }),
      );
    }

    return {
      token: decoded,
      caller_identity: decoded.sub,
      world_scope: decoded.scope,
    };
  });
