/**
 * T2.12 acceptance — token-bucket rate limit (60 capacity · 1/s refill).
 */
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { IdentityId } from "@0xhoneyjar/quests-protocol";

import { makeInMemoryRateLimiter } from "../auth/rate-limit.js";

const callerA = Schema.decodeUnknownSync(IdentityId)("id_caller");
const callerB = Schema.decodeUnknownSync(IdentityId)("id_callerb");

describe("makeInMemoryRateLimiter", () => {
  it("permits 60 calls then rejects the 61st", () => {
    const limiter = makeInMemoryRateLimiter();
    const now = Date.now();
    for (let i = 0; i < 60; i++) {
      const result = limiter.check(callerA, now);
      expect(result.allowed).toBe(true);
    }
    const sixtyfirst = limiter.check(callerA, now);
    expect(sixtyfirst.allowed).toBe(false);
    expect(sixtyfirst.retry_after_seconds).toBeGreaterThan(0);
  });

  it("retry_after_seconds reflects refill rate", () => {
    const limiter = makeInMemoryRateLimiter();
    const now = Date.now();
    for (let i = 0; i < 60; i++) limiter.check(callerA, now);
    const result = limiter.check(callerA, now);
    expect(result.allowed).toBe(false);
    // bucket fully empty + 1 token needed → retry_after = 1s
    expect(result.retry_after_seconds).toBe(1);
  });

  it("refills correctly after elapsed time", () => {
    const limiter = makeInMemoryRateLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < 60; i++) limiter.check(callerA, t0);
    // 5 seconds later → 5 refilled tokens
    const t1 = t0 + 5_000;
    const result = limiter.check(callerA, t1);
    expect(result.allowed).toBe(true);
    expect(result.tokens_remaining).toBe(4);
  });

  it("isolates buckets per caller", () => {
    const limiter = makeInMemoryRateLimiter();
    const now = Date.now();
    for (let i = 0; i < 60; i++) limiter.check(callerA, now);
    const a = limiter.check(callerA, now);
    expect(a.allowed).toBe(false);
    const b = limiter.check(callerB, now);
    expect(b.allowed).toBe(true);
  });

  it("caps refill at capacity", () => {
    const limiter = makeInMemoryRateLimiter({ capacity: 10, refillRatePerSecond: 1 });
    const t0 = 0;
    // consume 5 tokens
    for (let i = 0; i < 5; i++) limiter.check(callerA, t0);
    // 100s later → would be +100 tokens but capped at 10
    const peek = limiter.peek(callerA, t0 + 100_000);
    expect(peek).toBe(10);
  });

  it("supports custom capacity + refill rate", () => {
    const limiter = makeInMemoryRateLimiter({ capacity: 5, refillRatePerSecond: 2 });
    const t0 = 0;
    for (let i = 0; i < 5; i++) {
      expect(limiter.check(callerA, t0).allowed).toBe(true);
    }
    const denied = limiter.check(callerA, t0);
    expect(denied.allowed).toBe(false);
    // refill rate 2/s → 1 token in 500ms
    const t1 = t0 + 500;
    expect(limiter.check(callerA, t1).allowed).toBe(true);
  });
});
