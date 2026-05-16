import { Effect } from "effect";

import type { ActivityId } from "@0xhoneyjar/quests-protocol";
import {
  type IdentityId,
  type ProgressAdvanced,
  type ProgressError,
  type ProgressPort,
  ProgressActivityNotFound,
  ProgressAdapterUnavailable,
  ProgressConcurrentUpdate,
  ProgressIdentityNotFound,
  type ProgressRecord,
} from "@0xhoneyjar/quests-protocol";

/**
 * Key for the per-(activity, identity) ProgressRecord map.
 * Composite of the two branded IDs joined with `::` — a structural choice
 * not exported because callers never need to recompute it.
 */
const recordKey = (activityId: ActivityId, identityId: IdentityId): string =>
  `${activityId as unknown as string}::${identityId as unknown as string}`;

/**
 * Configuration for {@link makeInMemoryProgressPort}.
 *
 * - `knownActivities` — opt-in set of ActivityIds that exist in the
 *   catalog. When provided, getProgress / advanceProgress on an
 *   activity outside the set fails with ProgressError.ActivityNotFound.
 *   Omitting it means "every activity exists" (test-fixture default).
 * - `knownIdentities` — same shape, but for IdentityIds. Omitting it
 *   means "every identity exists" (test-fixture default).
 * - `adapterId` — opaque label surfaced inside AdapterUnavailable
 *   errors; defaults to "in-memory:progress".
 * - `simulatedFailures` — opt-in fault injection used by tests to
 *   reach the AdapterUnavailable variant (CL-Port-2 reachability).
 *   Each entry is a one-shot — consumed on first match, then cleared.
 */
export interface InMemoryProgressPortConfig {
  readonly knownActivities?: ReadonlySet<ActivityId>;
  readonly knownIdentities?: ReadonlySet<IdentityId>;
  readonly adapterId?: string;
  readonly simulatedFailures?: ReadonlyArray<{
    readonly on: "getProgress" | "advanceProgress" | "any";
    readonly reason: string;
  }>;
}

/**
 * The mutable runtime state behind the adapter — exposed so tests can
 * inspect or seed records without going through the Effect-returning
 * port surface. Production callers MUST use the port.
 */
export interface InMemoryProgressPortHandle {
  readonly port: ProgressPort;
  readonly seed: (record: ProgressRecord) => void;
  readonly snapshot: () => ReadonlyMap<string, ProgressRecord>;
  readonly clear: () => void;
}

/**
 * makeInMemoryProgressPort — constructs an in-memory ProgressPort
 * implementation suitable for unit tests + local development
 * (T2.1 · SDD §3.3 · per CL-Port-1..3).
 *
 * Invariants enforced:
 *   - CL-Port-1: every operation returns Effect; never throws
 *   - CL-Port-2: every ProgressError variant is REACHABLE — the
 *     simulatedFailures hook drives AdapterUnavailable; the
 *     known* sets drive *NotFound; the version check drives
 *     ConcurrentUpdate.
 *   - CL-Progress-1: advanceProgress is optimistic-concurrency-safe
 *     — version_before must match the stored record's version, OR
 *     the call must be a creation (no stored record · version_before == 0).
 *
 * NOT enforced (left to caller / future contract):
 *   - schema-level validation of ProgressAdvanced shape (caller
 *     responsibility — the substrate already validates at decode time)
 *   - merging step_completions ordering (we trust the producer; the
 *     ProgressRecord.steps_completed array is replaced wholesale
 *     with the union of existing + new completions in `new_step_completions`).
 */
export const makeInMemoryProgressPort = (
  config: InMemoryProgressPortConfig = {},
): InMemoryProgressPortHandle => {
  const adapterId = config.adapterId ?? "in-memory:progress";
  const store = new Map<string, ProgressRecord>();
  // Mutable copy so we can consume one-shot entries.
  const pendingFailures = [...(config.simulatedFailures ?? [])];

  const consumeSimulatedFailure = (
    op: "getProgress" | "advanceProgress",
  ): string | null => {
    const idx = pendingFailures.findIndex((f) => f.on === op || f.on === "any");
    if (idx === -1) return null;
    const failure = pendingFailures[idx]!;
    pendingFailures.splice(idx, 1);
    return failure.reason;
  };

  const isKnownActivity = (id: ActivityId): boolean =>
    config.knownActivities === undefined || config.knownActivities.has(id);
  const isKnownIdentity = (id: IdentityId): boolean =>
    config.knownIdentities === undefined || config.knownIdentities.has(id);

  const port: ProgressPort = {
    getProgress: (activityId, identityId) =>
      Effect.gen(function* () {
        const failureReason = consumeSimulatedFailure("getProgress");
        if (failureReason !== null) {
          return yield* Effect.fail(
            ProgressAdapterUnavailable.make({ adapter_id: adapterId, reason: failureReason }),
          );
        }
        if (!isKnownActivity(activityId)) {
          return yield* Effect.fail(
            ProgressActivityNotFound.make({ activity_id: activityId }),
          );
        }
        if (!isKnownIdentity(identityId)) {
          return yield* Effect.fail(
            ProgressIdentityNotFound.make({ identity_id: identityId }),
          );
        }
        const stored = store.get(recordKey(activityId, identityId));
        if (stored === undefined) {
          // No record yet → return the canonical "not started" baseline. The
          // ProgressRecord schema requires non-null fields for activity_id /
          // identity_id / version / lifecycle_state — these are derivable
          // without inventing data.
          return {
            activity_id: activityId,
            identity_id: identityId,
            current_step: null,
            steps_completed: [],
            last_advanced_event_id: null,
            version: 0,
            lifecycle_state: "NOT_STARTED",
          } satisfies ProgressRecord;
        }
        return stored;
      }) as Effect.Effect<ProgressRecord, ProgressError>,

    advanceProgress: (event: ProgressAdvanced) =>
      Effect.gen(function* () {
        const failureReason = consumeSimulatedFailure("advanceProgress");
        if (failureReason !== null) {
          return yield* Effect.fail(
            ProgressAdapterUnavailable.make({ adapter_id: adapterId, reason: failureReason }),
          );
        }
        if (!isKnownActivity(event.activity_id)) {
          return yield* Effect.fail(
            ProgressActivityNotFound.make({ activity_id: event.activity_id }),
          );
        }
        if (!isKnownIdentity(event.identity_id)) {
          return yield* Effect.fail(
            ProgressIdentityNotFound.make({ identity_id: event.identity_id }),
          );
        }
        const key = recordKey(event.activity_id, event.identity_id);
        const stored = store.get(key);
        const storedVersion = stored?.version ?? 0;
        if (event.version_before !== storedVersion) {
          return yield* Effect.fail(
            ProgressConcurrentUpdate.make({
              activity_id: event.activity_id,
              current_version: storedVersion,
              attempted_version: event.version_before,
            }),
          );
        }
        // Merge: existing completions + new completions (caller-ordered).
        const mergedCompletions = stored
          ? [...stored.steps_completed, ...event.new_step_completions]
          : [...event.new_step_completions];
        const last = mergedCompletions.length === 0
          ? null
          : mergedCompletions[mergedCompletions.length - 1] ?? null;
        const nextRecord: ProgressRecord = {
          activity_id: event.activity_id,
          identity_id: event.identity_id,
          current_step: last?.step_id ?? null,
          steps_completed: mergedCompletions,
          last_advanced_event_id: event.event_id,
          version: event.version_after,
          // The Activity-completion event drives lifecycle transitions to
          // COMPLETED. Progress events alone move NOT_STARTED → IN_PROGRESS
          // and stay there until the engine emits ActivityCompleted.
          lifecycle_state: "IN_PROGRESS",
        };
        store.set(key, nextRecord);
        return nextRecord;
      }) as Effect.Effect<ProgressRecord, ProgressError>,
  };

  return {
    port,
    seed: (record) => {
      store.set(recordKey(record.activity_id, record.identity_id), record);
    },
    snapshot: () => new Map(store),
    clear: () => store.clear(),
  };
};
