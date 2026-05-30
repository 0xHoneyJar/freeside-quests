/**
 * Shared helpers for the activity-supertype READ routes.
 *
 *  - `degraded(...)` — the `completeness: { status: "degraded" }` envelope the
 *    SDD mandates (§8 + §12.4 / IMP-008): when no DB is wired, data routes
 *    return 200 with an explicit degraded envelope rather than 500ing or
 *    silently serving empty. Consumers MUST surface degraded reads.
 *
 *  - `runRead(...)` — bridge a port Effect (an Effect<A, E>) to a Hyper handler
 *    return. On success → 200 with `{ items|record, completeness: full }`. On a
 *    sealed port error → mapped HTTP status carrying the `_tag`. Hyper handlers
 *    are plain async (they `Effect.runPromise` the engine) — there is NO
 *    Hyper↔Effect friction (OQ-2): Hyper coerces handler return values to
 *    Responses; the engine stays Effect-native behind the boundary.
 */

import { Cause, Effect, Exit, Option } from "effect";
import { badRequest, notFound, ok, unprocessable, jsonResponse } from "@hyper/core";

export type Completeness =
  | { readonly status: "full" }
  | { readonly status: "degraded"; readonly reason: string; readonly fallback_source: string };

export const FULL: Completeness = { status: "full" };

/** Build the degraded envelope payload (200, empty items). */
export const degraded = (reason: string): Response =>
  ok({
    items: [] as ReadonlyArray<never>,
    next_cursor: null,
    total_count: null,
    completeness: {
      status: "degraded" as const,
      reason,
      fallback_source: "none (cubquest-db not bound)",
    } satisfies Completeness,
  });

/** Degraded single-record variant (for get-progress shape). */
export const degradedRecord = (reason: string): Response =>
  jsonResponse(503, {
    record: null,
    completeness: {
      status: "degraded" as const,
      reason,
      fallback_source: "none (cubquest-db not bound)",
    } satisfies Completeness,
  });

const HTTP_FOR_TAG: Record<string, number> = {
  ActivityNotFound: 404,
  IdentityNotFound: 404,
  AlreadyGranted: 200,
  IdentityUnresolvable: 422,
  AdapterUnavailable: 503,
  ConcurrentUpdate: 409,
  // EventError variants
  DuplicateEvent: 409,
  CASFailed: 409,
  SchemaValidation: 422,
  PartitionScopeMismatch: 400,
  NonceRequired: 400,
  NonceCollision: 409,
  CanonicalizationFailed: 422,
};

/**
 * Run a read Effect and shape the HTTP response. `wrap` maps the success value
 * into the response body (e.g. into an `items` page or a `record`).
 */
export const runRead = async <A>(
  effect: Effect.Effect<A, { readonly _tag: string }>,
  wrap: (value: A) => unknown,
): Promise<Response> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return ok(wrap(exit.value));
  }
  // Defect (non-Fail) — surface as 500 with no internal leak.
  const failure = Exit.causeOption(exit);
  const err = extractTaggedFailure(failure);
  if (err === null) {
    return jsonResponse(500, { error: "internal", completeness: { status: "degraded", reason: "adapter defect" } });
  }
  const status = HTTP_FOR_TAG[err._tag] ?? 500;
  const body = { error: err._tag, detail: err, completeness: FULL };
  if (status === 404) return notFound(body as { code?: string });
  if (status === 400) return badRequest(body as { code?: string });
  if (status === 422) return unprocessable(body as { code?: string });
  return jsonResponse(status, body);
};

const extractTaggedFailure = (
  causeOpt: Option.Option<Cause.Cause<{ readonly _tag: string }>>,
): { readonly _tag: string } | null => {
  if (Option.isNone(causeOpt)) return null;
  const failureOpt = Cause.failureOption(causeOpt.value);
  if (Option.isNone(failureOpt)) return null;
  const first = failureOpt.value;
  if (typeof first === "object" && first !== null && "_tag" in first) {
    return first as { readonly _tag: string };
  }
  return null;
};
