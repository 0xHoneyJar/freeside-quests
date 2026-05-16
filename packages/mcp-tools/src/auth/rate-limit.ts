/**
 * Per-caller rate limit (T2.12 · D23 · DEV-ONLY).
 *
 * Token-bucket algorithm:
 *   - capacity: 60 tokens (default)
 *   - refill: 1 token per second (default)
 *   - per-caller-identity bucket
 *
 * Production worlds replace this with a Redis token-bucket (atomic
 * INCRBY + EXPIRE). The interface this file publishes (`RateLimiter`)
 * is the canonical surface; the in-memory implementation here is the
 * DEV-ONLY default. Worlds plug in their RateLimiter at composition root.
 */
import { Data } from "effect";

import type { IdentityId } from "@0xhoneyjar/quests-protocol";

export class RateLimitExceeded extends Data.TaggedError("RateLimitExceeded")<{
  readonly caller_identity: IdentityId;
  readonly retry_after_seconds: number;
}> {}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly tokens_remaining: number;
  readonly retry_after_seconds: number;
}

/**
 * Canonical RateLimiter interface. Both the in-memory dev-default and
 * production Redis-backed implementations conform to this shape.
 */
export interface RateLimiter {
  readonly check: (
    caller: IdentityId,
    nowMs: number,
    tokensToConsume?: number,
  ) => RateLimitResult;
  readonly peek: (caller: IdentityId, nowMs: number) => number;
}

export interface InMemoryRateLimiterConfig {
  /** Bucket capacity per caller. Default: 60. */
  readonly capacity?: number;
  /** Tokens added per second of elapsed time. Default: 1. */
  readonly refillRatePerSecond?: number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export const makeInMemoryRateLimiter = (
  config: InMemoryRateLimiterConfig = {},
): RateLimiter => {
  const capacity = config.capacity ?? 60;
  const refillRatePerSecond = config.refillRatePerSecond ?? 1;
  const buckets = new Map<string, Bucket>();

  const refill = (bucket: Bucket, nowMs: number): void => {
    if (nowMs <= bucket.lastRefillMs) return;
    const elapsedSeconds = (nowMs - bucket.lastRefillMs) / 1000;
    const refillAmount = elapsedSeconds * refillRatePerSecond;
    bucket.tokens = Math.min(capacity, bucket.tokens + refillAmount);
    bucket.lastRefillMs = nowMs;
  };

  return {
    check: (caller, nowMs, tokensToConsume = 1) => {
      const callerKey = caller as unknown as string;
      let bucket = buckets.get(callerKey);
      if (bucket === undefined) {
        bucket = { tokens: capacity, lastRefillMs: nowMs };
        buckets.set(callerKey, bucket);
      }
      refill(bucket, nowMs);
      if (bucket.tokens < tokensToConsume) {
        const deficit = tokensToConsume - bucket.tokens;
        const retryAfter = Math.ceil(deficit / refillRatePerSecond);
        return {
          allowed: false,
          tokens_remaining: Math.floor(bucket.tokens),
          retry_after_seconds: retryAfter,
        };
      }
      bucket.tokens -= tokensToConsume;
      return {
        allowed: true,
        tokens_remaining: Math.floor(bucket.tokens),
        retry_after_seconds: 0,
      };
    },
    peek: (caller, nowMs) => {
      const callerKey = caller as unknown as string;
      const bucket = buckets.get(callerKey);
      if (bucket === undefined) return capacity;
      refill(bucket, nowMs);
      return Math.floor(bucket.tokens);
    },
  };
};
