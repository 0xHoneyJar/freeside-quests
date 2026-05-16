/**
 * AuthReplayStore — distributed jti replay protection port (sprint-2 review C1).
 *
 * Defined per sprint-plan §12.3 Fix-S6 + Fix-S7. Production implementation
 * uses Redis SETEX or equivalent atomic SETNX. Test fixture uses an
 * in-memory bounded LRU.
 *
 * Contract (per Fix-S6 + Fix-S7):
 *   - record(jti, now_ms) atomically returns whether this is the first
 *     observation within the replay window.
 *   - second observation within the window → `{ fresh: false, first_seen_ms }`
 *     (caller rejects token with ReplayDetected).
 *   - GC happens automatically — entries older than TOKEN_REPLAY_WINDOW_SECONDS
 *     are evicted by the store implementation (Redis: SETEX expiry · in-memory:
 *     LRU + TTL sweep).
 *   - Cold-start posture: configurable. Default = accept-on-cold-start
 *     (production with Redis warm cache is the common path); strict mode
 *     rejects all jtis until the window elapses (paranoid posture for
 *     fresh-deploy scenarios).
 */
import type { Effect } from "effect";
import { Data } from "effect";

export interface RecordOutcome {
  readonly fresh: boolean;
  readonly first_seen_unix_ms: number;
}

export class ReplayStoreUnavailable extends Data.TaggedError("ReplayStoreUnavailable")<{
  readonly store_id: string;
  readonly reason: string;
}> {}

export type ReplayStoreError = ReplayStoreUnavailable;

/**
 * AuthReplayStore — substrate seam for jti replay tracking
 * (cross-pack via Effect Tag identity).
 *
 * Implementations:
 *   - production: Redis SETEX (atomic · network-distributed across
 *     gateway replicas)
 *   - test fixture: in-memory bounded LRU + TTL sweep (the
 *     `makeInMemoryJTIReplayTracker` already implements the same shape
 *     synchronously; the port wraps it in Effect for adapter swappability)
 */
export interface AuthReplayStore {
  readonly record: (
    jti: string,
    now_unix_ms: number,
  ) => Effect.Effect<RecordOutcome, ReplayStoreError>;

  /**
   * Returns the current number of tracked jtis. For observability / SLI
   * metrics. Production implementations may return `null` if the underlying
   * store doesn't cheaply expose size (Redis SCARD on a keyspace is O(N)).
   */
  readonly size?: () => Effect.Effect<number | null, ReplayStoreError>;
}
