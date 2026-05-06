/**
 * sietch.test.ts — verified-path AuthCheck adapter coverage (cycle-B
 * sprint-1 · B-1.9 · AC-B1.9.1).
 *
 * Validates:
 *   - Successful JWT verification + tenant match → is_verified=true
 *   - Recoverable verify failures (malformed · expired · unknown_kid) →
 *     is_verified=false + verify_error populated (does NOT die)
 *   - Audience mismatch → is_verified=false + verify_error.code='wrong_audience'
 *   - I6 tenant boundary assertion failure → Effect.die with
 *     TenantAssertionError (catastrophic · cannot recover · cannot
 *     fall back to anon)
 *   - Verifier promise rejection → mapped to verify_error with
 *     code='unknown_kid_refresh_failed' (treats throws as recoverable)
 *   - Tag identity preserved (A2 cross-pack lock · same as Anon Layer)
 *   - display_handle plumbed from claims.display_name when present
 */

import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import {
  AuthCheckPort,
  AUTH_CHECK_PORT_TAG_IDENTITY,
  buildAuthCheckPortSietchLayer,
  SietchInfrastructureError,
  TenantAssertionError,
  type JWTVerifierPort,
  type VerifyResult,
} from "../index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_JWT = "fake.jwt.token.for.tests";
const FIXTURE_TENANT = "mibera";
const FIXTURE_SUB = "user-mibera-001";

const verifierOk = (
  overrides: Partial<{
    tenant: string;
    aud: string;
    sub: string;
    display_name: string;
  }> = {},
): JWTVerifierPort => ({
  verifyJwt: async () => ({
    ok: true,
    claims: {
      tenant: overrides.tenant ?? FIXTURE_TENANT,
      aud: overrides.aud ?? FIXTURE_TENANT,
      sub: overrides.sub ?? FIXTURE_SUB,
      exp: Math.floor(Date.now() / 1000) + 3600,
      display_name: overrides.display_name,
    },
  }),
});

const verifierFails = (
  code:
    | "malformed"
    | "expired"
    | "wrong_audience"
    | "unknown_kid_refresh_failed",
  reason = "verifier returned ok:false",
): JWTVerifierPort => ({
  verifyJwt: async (): Promise<VerifyResult> => ({
    ok: false,
    error: { code, reason },
  }),
});

const verifierThrows = (msg = "network reset"): JWTVerifierPort => ({
  verifyJwt: async () => {
    throw new Error(msg);
  },
});

// Convenience wrapper: runs the AuthCheck program for a given verifier +
// expected tenant · returns the AuthCheck result OR throws on Effect die.
const runCheck = async (
  verifier: JWTVerifierPort,
  expected_tenant = FIXTURE_TENANT,
) => {
  const layer = buildAuthCheckPortSietchLayer(
    { jwt: FIXTURE_JWT, expected_tenant },
    verifier,
  );
  const program = Effect.gen(function* () {
    const port = yield* AuthCheckPort;
    return yield* port.check({
      type: "anon" as const,
      discord_id: "111111111111111111" as never,
    });
  }).pipe(Effect.provide(layer));
  return Effect.runPromise(program);
};

// Run that catches Effect defects · returns Exit so callers can assert die
const runCheckExit = (
  verifier: JWTVerifierPort,
  expected_tenant = FIXTURE_TENANT,
) => {
  const layer = buildAuthCheckPortSietchLayer(
    { jwt: FIXTURE_JWT, expected_tenant },
    verifier,
  );
  const program = Effect.gen(function* () {
    const port = yield* AuthCheckPort;
    return yield* port.check({
      type: "anon" as const,
      discord_id: "111111111111111111" as never,
    });
  }).pipe(Effect.provide(layer));
  return Effect.runPromiseExit(program);
};

// ---------------------------------------------------------------------------
// Tag identity (A2 cross-pack lock)
// ---------------------------------------------------------------------------

describe("Sietch AuthCheck Layer · Tag identity (A2 cross-pack lock)", () => {
  it("preserves AUTH_CHECK_PORT_TAG_IDENTITY · same Tag as Anon Layer", () => {
    expect(AUTH_CHECK_PORT_TAG_IDENTITY).toBe(
      "@freeside-quests/AuthCheckPort",
    );
    expect(AuthCheckPort.key).toBe(AUTH_CHECK_PORT_TAG_IDENTITY);
  });

  it("Sietch Layer composes with the same AuthCheckPort Tag (no signature change)", () => {
    const layer = buildAuthCheckPortSietchLayer(
      { jwt: FIXTURE_JWT, expected_tenant: FIXTURE_TENANT },
      verifierOk(),
    );
    expect(layer).toBeDefined();
    // Tag identity is the load-bearing contract · just structural existence is
    // sufficient · the runtime test below proves the Layer satisfies the port.
  });
});

// ---------------------------------------------------------------------------
// Successful verify path
// ---------------------------------------------------------------------------

describe("Sietch AuthCheck · successful verification", () => {
  it("is_verified=true when verifier ok + tenant matches", async () => {
    const result = await runCheck(verifierOk());
    expect(result.is_verified).toBe(true);
    expect(result.verify_error).toBeUndefined();
  });

  it("display_handle plumbed from claims.display_name when present", async () => {
    const result = await runCheck(verifierOk({ display_name: "Munkh" }));
    expect(result.is_verified).toBe(true);
    expect(result.display_handle).toBe("Munkh");
  });

  it("display_handle is undefined when claims.display_name is absent", async () => {
    const result = await runCheck(verifierOk());
    expect(result.is_verified).toBe(true);
    expect(result.display_handle).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Recoverable verify failures (per AC-B1.9.1)
// ---------------------------------------------------------------------------

describe("Sietch AuthCheck · recoverable verify failures (AC-B1.9.1)", () => {
  it("malformed token → is_verified=false + verify_error.code='malformed'", async () => {
    const result = await runCheck(verifierFails("malformed", "JWT parse error"));
    expect(result.is_verified).toBe(false);
    expect(result.verify_error?.code).toBe("malformed");
    expect(result.verify_error?.reason).toContain("parse error");
  });

  it("expired token → is_verified=false + verify_error.code='expired'", async () => {
    const result = await runCheck(verifierFails("expired", "exp=1700000000 < now"));
    expect(result.is_verified).toBe(false);
    expect(result.verify_error?.code).toBe("expired");
  });

  it("unknown kid → is_verified=false + verify_error.code='unknown_kid_refresh_failed'", async () => {
    const result = await runCheck(
      verifierFails("unknown_kid_refresh_failed", "kid not in JWKS · refresh 503"),
    );
    expect(result.is_verified).toBe(false);
    expect(result.verify_error?.code).toBe("unknown_kid_refresh_failed");
  });

  it("verifier promise rejection → Effect.die SietchInfrastructureError (NOT recoverable downgrade)", async () => {
    // Cross-reviewer flatline finding (PR #13 · CRITICAL 810): verifier-thrown
    // infra errors must NOT silently downgrade to anon during outages. The
    // Layer surfaces them as Effect defect so the dispatcher's outer error
    // handler treats them as 5xx-equivalent.
    const exit = await runCheckExit(verifierThrows("network reset"));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const causeStr = JSON.stringify(exit.cause, (_k, v) =>
        v instanceof Error ? { name: v.name, message: v.message } : v,
      );
      expect(causeStr).toContain("SietchInfrastructureError");
      expect(causeStr).toContain("network reset");
    }
  });

  it("redacts JWT-shaped substrings from infrastructure-error messages (Bridgebuilder F4)", async () => {
    // Token bytes shouldn't leak into error logs · the redactor strips
    // anything that looks like xxx.yyy.zzz with base64-ish segments.
    const verifierThrowsWithToken: JWTVerifierPort = {
      verifyJwt: async () => {
        throw new Error(
          "validation rejected for eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.aBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgHiJ at jwks-validator.ts",
        );
      },
    };
    const exit = await runCheckExit(verifierThrowsWithToken);
    if (Exit.isFailure(exit)) {
      const causeStr = JSON.stringify(exit.cause, (_k, v) =>
        v instanceof Error ? { name: v.name, message: v.message } : v,
      );
      // The JWT-shaped substring should be replaced with [redacted-jwt]
      expect(causeStr).toContain("[redacted-jwt]");
      // The original token payload bytes should NOT appear in the message
      expect(causeStr).not.toContain("eyJhbGciOiJFUzI1NiJ9");
    }
  });
});

// ---------------------------------------------------------------------------
// Audience mismatch (recoverable per AC-B1.9.1)
// ---------------------------------------------------------------------------

describe("Sietch AuthCheck · audience mismatch (recoverable)", () => {
  it("aud != expected_tenant → is_verified=false + verify_error.code='wrong_audience'", async () => {
    // Verifier returns ok with aud=cubquest, but Sietch expects mibera.
    // BUT — tenant is also wrong here. We need a case where aud≠expected
    // but tenant=expected. That's an unusual but possible state: the JWT
    // was issued for a different audience even though it claims mibera tenant.
    // Construct that scenario:
    const verifier = verifierOk({ aud: "cubquest", tenant: FIXTURE_TENANT });
    const result = await runCheck(verifier, FIXTURE_TENANT);
    expect(result.is_verified).toBe(false);
    expect(result.verify_error?.code).toBe("wrong_audience");
    expect(result.verify_error?.reason).toContain("cubquest");
    expect(result.verify_error?.reason).toContain("mibera");
  });

  it("aud match + tenant match → is_verified=true (positive control)", async () => {
    const result = await runCheck(verifierOk(), FIXTURE_TENANT);
    expect(result.is_verified).toBe(true);
    expect(result.verify_error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// I6 tenant boundary assertion (catastrophic · Effect.die)
// ---------------------------------------------------------------------------

describe("Sietch AuthCheck · I6 tenant assertion (Effect.die · cannot recover)", () => {
  it("tenant mismatch (signature valid + aud match) → Effect.die with TenantAssertionError", async () => {
    // Construct a JWT that claims aud=mibera (matches expected) but tenant=cubquest.
    // This is the I6 catastrophic case: the verifier passed everything (signature ·
    // aud · exp), but the per-tenant claim doesn't match the world's tenant.
    // The Sietch Layer MUST halt processing · cannot fall back to anon.
    const verifier = verifierOk({ aud: FIXTURE_TENANT, tenant: "cubquest" });

    const exit = await runCheckExit(verifier, FIXTURE_TENANT);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      // Effect.die produces a Defect cause · grab it via squash
      const error = (exit.cause as { defect?: unknown; _tag?: string }) ?? null;
      // The simplest robust check: stringify the cause and look for our marker
      const causeStr = JSON.stringify(exit.cause, (_k, v) =>
        v instanceof Error ? { name: v.name, message: v.message } : v,
      );
      expect(causeStr).toContain("tenant_assertion_failed");
      expect(causeStr).toContain("cubquest");
      expect(causeStr).toContain("mibera");
      void error; // satisfy eslint-no-unused
    }
  });

  it("TenantAssertionError carries got/expected/sub for telemetry", () => {
    const err = new TenantAssertionError("cubquest", "mibera", "user-001");
    expect(err.got_tenant).toBe("cubquest");
    expect(err.expected_tenant).toBe("mibera");
    expect(err.sub).toBe("user-001");
    expect(err.message).toContain("tenant_assertion_failed");
    expect(err.name).toBe("TenantAssertionError");
  });

  it("regression · ordering: tenant=X aud=X expected=Y → Effect.die (NOT wrong_audience)", async () => {
    // Cross-reviewer flatline finding (PR #13 · CRITICAL 880): if the audience
    // check fired before the tenant assertion, this case would return
    // recoverable `wrong_audience` and downgrade to anon on fallback routes —
    // a security boundary breach. The fix moves tenant assertion BEFORE
    // audience check · this test pins the correct ordering.
    //
    // Scenario: a valid mibera JWT (tenant=mibera, aud=mibera) is presented
    // to a request expecting cubquest. Cross-tenant token MUST halt processing.
    const verifier = verifierOk({
      tenant: "mibera",
      aud: "mibera",
    });
    const exit = await runCheckExit(verifier, "cubquest");
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const causeStr = JSON.stringify(exit.cause, (_k, v) =>
        v instanceof Error ? { name: v.name, message: v.message } : v,
      );
      expect(causeStr).toContain("TenantAssertionError");
      expect(causeStr).toContain("tenant_assertion_failed");
      expect(causeStr).toContain("mibera");
      expect(causeStr).toContain("cubquest");
      // Critical · the recoverable code MUST NOT appear in the cause
      expect(causeStr).not.toContain("wrong_audience");
    }
  });

  it("ordering: when tenant matches but aud differs, returns wrong_audience (positive control)", async () => {
    // Mirror of the CRITICAL ordering test · proves audience check still
    // engages once the tenant assertion has passed (recoverable downgrade
    // for legitimate misroute · e.g., a ruggy JWT used for a quest path).
    const verifier = verifierOk({
      tenant: "mibera",
      aud: "cubquest",
    });
    const result = await runCheck(verifier, "mibera");
    expect(result.is_verified).toBe(false);
    expect(result.verify_error?.code).toBe("wrong_audience");
  });
});

// ---------------------------------------------------------------------------
// Composability — does the new Layer satisfy AuthCheckPort.check signature?
// ---------------------------------------------------------------------------

describe("Sietch AuthCheck · port satisfaction (Effect type compatibility)", () => {
  it("layer is provideable to a program that requires AuthCheckPort", async () => {
    const layer = buildAuthCheckPortSietchLayer(
      { jwt: FIXTURE_JWT, expected_tenant: FIXTURE_TENANT },
      verifierOk(),
    );
    // Just compile-time + runtime check that the Layer satisfies the port
    const program = Effect.gen(function* () {
      const port = yield* AuthCheckPort;
      return port;
    }).pipe(Effect.provide(layer));

    const port = await Effect.runPromise(program);
    expect(typeof port.check).toBe("function");
  });
});
