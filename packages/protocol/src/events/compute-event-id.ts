import { Effect } from "effect";

import { canonicalizeJCS, sha256JCS } from "../encoding/jcs.js";
import type { EventError } from "./EventError.js";
import { NonceRequired } from "./EventError.js";

/**
 * Substring fragments of `$id` that mark an event as MUTATING (Fix-A1).
 *
 * Mutating events MUST carry a caller-supplied nonce — the substrate refuses
 * to derive a UUID fallback for them because that would break idempotency
 * (caller retrying the same event with no nonce would produce two distinct
 * event_ids, defeating the contract).
 *
 * Non-mutating events (RewardGranted, RewardFailed) are emitted by the
 * engine itself and the engine controls retry semantics, so a derived
 * nonce is permitted.
 */
const MUTATING_EVENT_FRAGMENTS = [
  "activity-completed",
  "badge-issued",
  "raffle-drawn",
  "progress-advanced",
  "reward-pending",
] as const;

/**
 * Decides whether `event.$id` names a mutating event type (Fix-A1).
 * Pure function; safe to call inside an Effect.gen without yielding.
 */
export const isMutatingEvent = (event: { readonly $id: string }): boolean => {
  for (const fragment of MUTATING_EVENT_FRAGMENTS) {
    if (event.$id.includes(fragment)) {
      return true;
    }
  }
  return false;
};

/**
 * Strips the `event_id` field from an event (§5.6 — preimage excludes
 * the self-reference). Returns a NEW object; does not mutate the input.
 */
const extractPreimage = (event: Record<string, unknown>): Record<string, unknown> => {
  const { event_id: _event_id, ...rest } = event;
  return rest;
};

/**
 * Sorts `step_completions` (if present) by canonical (order, step_id)
 * tie-break rule (§5.6 golden vectors). This produces deterministic
 * preimage encoding even when the producer hands the array in arbitrary
 * order.
 */
const sortStepCompletions = (preimage: Record<string, unknown>): Record<string, unknown> => {
  if (!("step_completions" in preimage)) return preimage;
  const raw = preimage.step_completions;
  if (!Array.isArray(raw)) return preimage;
  const sorted = [...raw].sort((a: unknown, b: unknown) => {
    const ao = (a as { order?: number }).order ?? 0;
    const bo = (b as { order?: number }).order ?? 0;
    if (ao !== bo) return ao - bo;
    const aid = String((a as { step_id?: unknown }).step_id ?? "");
    const bid = String((b as { step_id?: unknown }).step_id ?? "");
    return aid < bid ? -1 : aid > bid ? 1 : 0;
  });
  return { ...preimage, step_completions: sorted };
};

/**
 * computeEventId — the single authority for event_id derivation (A6 +
 * §5.6 · per Fix-A1 + Fix-A2).
 *
 * Pure-deterministic given the same input. Returns an Effect that fails
 * with {@link NonceRequired} for mutating events without nonce; otherwise
 * resolves to a 64-char lowercase hex digest matching the {@link EventId}
 * brand pattern.
 *
 * Algorithm (§5.6):
 *   1. Reject if isMutatingEvent && nonce == null (Fix-A1 · NonceRequired)
 *   2. Strip the `event_id` field from the preimage
 *   3. Sort step_completions by (order, step_id) for canonical ordering
 *   4. RFC 8785 canonicalize via canonicalizeJCS
 *   5. SHA-256 the canonical bytes → 64-char hex (sha256JCS)
 *
 * NO UUIDv4 fallback (Fix-A2). The caller MUST pass an explicit nonce on
 * mutating events.
 *
 * Per CL-Event-3 hash-determinism: same canonical preimage → same event_id.
 * Per CL-Event-5 collision-distinguishing: caller nonce makes otherwise-
 * identical events distinct.
 */
export const computeEventId = (
  event: Record<string, unknown> & { readonly $id: string; readonly nonce: string | null },
): Effect.Effect<string, EventError, never> =>
  Effect.gen(function* () {
    if (event.nonce == null && isMutatingEvent(event)) {
      return yield* Effect.fail(
        NonceRequired.make({
          event_type: event.$id,
          reason: "mutating events require caller-supplied nonce (Fix-A1)",
        }),
      );
    }
    const preimage = sortStepCompletions(extractPreimage(event));
    // canonicalize is pure; wrap in try/catch to surface as CanonicalizationFailed-shaped failure.
    let canonical: string;
    try {
      canonical = canonicalizeJCS(preimage);
    } catch (err) {
      return yield* Effect.fail({
        _tag: "CanonicalizationFailed" as const,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
    // sha256JCS uses crypto.subtle which is async; Effect.promise wraps it safely.
    const digest = yield* Effect.promise(async () => {
      // sha256JCS canonicalizes again internally; we already have the canonical string,
      // so hash the bytes directly through crypto.subtle to skip the redundant work.
      const encoded = new TextEncoder().encode(canonical);
      const buf = await crypto.subtle.digest("SHA-256", encoded);
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    });
    return digest;
  });

/**
 * Convenience sync helper for tests + golden-vector callers. Throws on
 * NonceRequired or canonicalization failure. Production callers should use
 * the Effect-returning {@link computeEventId}.
 */
export const computeEventIdSync = async (
  event: Record<string, unknown> & { readonly $id: string; readonly nonce: string | null },
): Promise<string> => {
  const result = await Effect.runPromise(computeEventId(event));
  return result;
};

/** Re-export sha256JCS so callers using the same hash surface can import here. */
export { sha256JCS };
