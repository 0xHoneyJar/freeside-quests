/**
 * Reward retry orchestrator (T2.8 · SDD §3.5 · per FR-4 + D18).
 *
 * Drives the RewardState machine:
 *
 *   Pending → Granted                                   (success)
 *   Pending → Failed (retryable=true)  → Pending (...)  (transient retry)
 *   Pending → Failed (retryable=false)                  (terminal)
 *
 * The retry orchestrator is a pluggable Effect — composition root supplies
 * the actual RewardPort via the activity port Tag. This file holds the
 * retry POLICY (max attempts · backoff) and the state-transition logic.
 */
import { Data, Duration, Effect } from "effect";

import {
  type ActivityReward,
  type EventId,
  type IdentityId,
  type RewardError,
  type RewardGranted,
  type RewardPort,
} from "@0xhoneyjar/quests-protocol";

import type { Schema } from "effect";

type RewardGrantedRecord = Schema.Schema.Type<typeof RewardGranted>;

/**
 * Configuration for {@link retryGrant}.
 *
 * - `maxAttempts` — total attempts including the first. Default: 3.
 * - `initialDelayMs` — base delay before the second attempt. Default: 100.
 * - `backoffFactor` — multiplier per retry. Default: 2 (exponential).
 * - `maxDelayMs` — cap applied per-attempt. Default: 30_000.
 * - `sleep` — injectable sleeper; defaults to Effect.sleep. Tests pass
 *   a no-op to skip waits.
 */
export interface RetryPolicy {
  readonly maxAttempts?: number;
  readonly initialDelayMs?: number;
  readonly backoffFactor?: number;
  readonly maxDelayMs?: number;
  readonly sleep?: (millis: number) => Effect.Effect<void>;
}

/**
 * RetryError — surfaced when retries are exhausted OR a non-retryable
 * failure aborts the loop. Wraps the last RewardError so callers can
 * inspect the final adapter response.
 */
export class RetriesExhausted extends Data.TaggedError("RetriesExhausted")<{
  readonly attempts: number;
  readonly last_error: RewardError;
}> {}

export class TerminalGrantFailure extends Data.TaggedError("TerminalGrantFailure")<{
  readonly last_error: RewardError;
}> {}

export type RetryError = RetriesExhausted | TerminalGrantFailure;

const computeDelay = (
  attempt: number,
  initial: number,
  factor: number,
  cap: number,
): number => Math.min(cap, initial * Math.pow(factor, attempt));

/**
 * Returns true if the failure should drive another attempt. AlreadyGranted
 * is treated as success (D18 idempotency) — the caller short-circuits
 * before reaching this predicate, but the helper is defensive in case
 * downstream logic forwards it.
 */
const isRetryable = (err: RewardError): boolean => {
  switch (err._tag) {
    case "AlreadyGranted":
      return false;
    case "GrantFailed":
      return err.retryable;
    case "IdentityUnresolvable":
      return false;
    case "AdapterUnavailable":
      return true;
  }
};

/**
 * retryGrant — orchestrates one reward grant with backoff. Returns the
 * RewardGranted record on success; fails with RetryError on exhaustion
 * or terminal failure.
 *
 * Idempotency note (D18): if the adapter returns AlreadyGranted on first
 * attempt, retryGrant interprets that as success-from-prior-attempt and
 * returns a synthesized RewardGranted record pulled via port.query.
 * Callers can therefore safely retry the SAME (originating_event_id,
 * recipient) without producing duplicates.
 */
export const retryGrant = (
  port: RewardPort,
  reward: ActivityReward,
  recipient: IdentityId,
  originatingEventId: EventId,
  policy: RetryPolicy = {},
): Effect.Effect<RewardGrantedRecord, RetryError> => {
  const maxAttempts = policy.maxAttempts ?? 3;
  const initialDelayMs = policy.initialDelayMs ?? 100;
  const backoffFactor = policy.backoffFactor ?? 2;
  const maxDelayMs = policy.maxDelayMs ?? 30_000;
  const sleep =
    policy.sleep ?? ((millis: number) => Effect.sleep(Duration.millis(millis)));

  return Effect.gen(function* () {
    let lastError: RewardError | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const outcome = yield* port
        .grant(reward, recipient, originatingEventId)
        .pipe(Effect.either);
      if (outcome._tag === "Right") {
        return outcome.right;
      }
      const err = outcome.left;
      lastError = err;

      // D18 short-circuit: AlreadyGranted means a prior attempt already
      // recorded the grant — surface the existing record via port.query.
      if (err._tag === "AlreadyGranted") {
        const grants = yield* port.query(recipient).pipe(Effect.either);
        if (grants._tag === "Right") {
          const match = grants.right.find(
            (g) => g.granted_event_id === err.existing_grant_id,
          );
          if (match !== undefined) return match;
        }
        // Couldn't recover the record — surface as terminal because the
        // adapter contract violation is non-retryable.
        return yield* Effect.fail(
          new TerminalGrantFailure({ last_error: err }),
        );
      }

      if (!isRetryable(err)) {
        return yield* Effect.fail(
          new TerminalGrantFailure({ last_error: err }),
        );
      }

      // Don't sleep after the last attempt
      if (attempt < maxAttempts - 1) {
        yield* sleep(computeDelay(attempt, initialDelayMs, backoffFactor, maxDelayMs));
      }
    }
    return yield* Effect.fail(
      new RetriesExhausted({
        attempts: maxAttempts,
        last_error: lastError as RewardError,
      }),
    );
  });
};
