import { Effect, Schema } from "effect";

import {
  type ActivityReward,
  type EventId,
  type IdentityId,
  RewardAdapterUnavailable,
  RewardAlreadyGranted,
  type RewardError,
  type RewardGranted,
  RewardGrantFailed,
  RewardIdentityUnresolvable,
  type RewardPort,
} from "@0xhoneyjar/quests-protocol";

type RewardGrantedRecord = Schema.Schema.Type<typeof RewardGranted>;

/**
 * Idempotency key per D18 — (originating_event_id, recipient) tuple.
 * Two grants with the same tuple MUST return the same RewardGranted
 * (CL-Reward-2). The substrate guarantees this at the adapter boundary
 * so engine-side retry loops are safe.
 */
const idempotencyKey = (
  originatingEventId: EventId,
  recipient: IdentityId,
): string => `${originatingEventId as unknown as string}::${recipient as unknown as string}`;

/**
 * Configuration for {@link makeInMemoryRewardPort}.
 *
 * - `unresolvableIdentities` — IdentityIds the resolver cannot bind to a
 *   chain address. Grants targeting these IDs fail with
 *   IdentityUnresolvable (CL-Port-2 reachability).
 * - `failingGrants` — IdentityIds whose next grant attempt fails (one-shot)
 *   with GrantFailed using the supplied `reason` + `retryable` flag. After
 *   firing, the entry is consumed; subsequent grants to the same identity
 *   proceed normally. Models a flaky downstream (FR-4.2 retry behavior).
 * - `adapterId` — opaque label surfaced inside AdapterUnavailable.
 *   Defaults to "in-memory:reward".
 * - `simulatedFailures` — same-shape one-shot AdapterUnavailable injector
 *   as ProgressPort's hook. Lets tests reach the AdapterUnavailable variant.
 * - `nextGrantedEventIdProvider` — function returning the synthetic
 *   granted_event_id used in the RewardGranted record. Defaults to a
 *   deterministic counter; tests can pass a fixed value.
 */
export interface InMemoryRewardPortConfig {
  readonly unresolvableIdentities?: ReadonlySet<IdentityId>;
  readonly failingGrants?: ReadonlyArray<{
    readonly recipient: IdentityId;
    readonly reason: string;
    readonly retryable: boolean;
  }>;
  readonly adapterId?: string;
  readonly simulatedFailures?: ReadonlyArray<{
    readonly on: "grant" | "query" | "any";
    readonly reason: string;
  }>;
  readonly nextGrantedEventIdProvider?: () => EventId;
  readonly timestampProvider?: () => string;
}

export interface InMemoryRewardPortHandle {
  readonly port: RewardPort;
  readonly snapshot: () => ReadonlyArray<RewardGrantedRecord>;
  readonly clear: () => void;
}

/**
 * makeInMemoryRewardPort — constructs an in-memory RewardPort suitable for
 * tests + dev (T2.4 · SDD §3.3 · per FR-8 + D18 + D24).
 *
 * Invariants enforced:
 *   - CL-Port-1: every operation returns Effect; never throws.
 *   - CL-Port-2: every RewardError variant is reachable — failingGrants
 *     drives GrantFailed; unresolvableIdentities drives IdentityUnresolvable;
 *     simulatedFailures drives AdapterUnavailable; same-tuple grant drives
 *     AlreadyGranted.
 *   - CL-Reward-2 (D18 idempotency): a grant call with a tuple that already
 *     exists returns the EXISTING RewardGranted record WRAPPED in an
 *     AlreadyGranted error variant (per FR-8: error-class encodes the
 *     "already granted" outcome so engine retry loops short-circuit).
 *     The original RewardGranted is still queryable via port.query.
 */
export const makeInMemoryRewardPort = (
  config: InMemoryRewardPortConfig = {},
): InMemoryRewardPortHandle => {
  const adapterId = config.adapterId ?? "in-memory:reward";
  const grants = new Map<string, RewardGrantedRecord>();
  // index by recipient for query()
  const grantsByRecipient = new Map<string, RewardGrantedRecord[]>();

  const pendingFailures = [...(config.simulatedFailures ?? [])];
  const pendingFailingGrants = [...(config.failingGrants ?? [])];

  const consumeSimulatedFailure = (op: "grant" | "query"): string | null => {
    const idx = pendingFailures.findIndex((f) => f.on === op || f.on === "any");
    if (idx === -1) return null;
    const failure = pendingFailures[idx]!;
    pendingFailures.splice(idx, 1);
    return failure.reason;
  };

  const consumeFailingGrant = (
    recipient: IdentityId,
  ): { reason: string; retryable: boolean } | null => {
    const idx = pendingFailingGrants.findIndex(
      (f) => (f.recipient as unknown as string) === (recipient as unknown as string),
    );
    if (idx === -1) return null;
    const failure = pendingFailingGrants[idx]!;
    pendingFailingGrants.splice(idx, 1);
    return { reason: failure.reason, retryable: failure.retryable };
  };

  // Deterministic synthetic EventId generator. Production resolvers either
  // use the original ActivityCompleted's hash, the txn hash from chain, or a
  // resolver-side hash; we ship a counter to keep tests cheap.
  let counter = 0;
  const defaultGrantedEventId = (): EventId => {
    counter += 1;
    const hex = counter.toString(16).padStart(64, "f");
    return hex as unknown as EventId;
  };

  const defaultTimestamp = (): string => "2026-05-16T00:00:00Z";

  const grantedEventIdProvider =
    config.nextGrantedEventIdProvider ?? defaultGrantedEventId;
  const timestampProvider = config.timestampProvider ?? defaultTimestamp;

  const port: RewardPort = {
    grant: (
      reward: ActivityReward,
      recipient: IdentityId,
      originatingEventId: EventId,
    ) =>
      Effect.gen(function* () {
        const failureReason = consumeSimulatedFailure("grant");
        if (failureReason !== null) {
          return yield* Effect.fail(
            RewardAdapterUnavailable.make({ adapter_id: adapterId, reason: failureReason }),
          );
        }

        // CL-Reward-2 (D18): idempotency-by-tuple
        const key = idempotencyKey(originatingEventId, recipient);
        const existing = grants.get(key);
        if (existing !== undefined) {
          return yield* Effect.fail(
            RewardAlreadyGranted.make({
              originating_event_id: originatingEventId,
              existing_grant_id: existing.granted_event_id,
            }),
          );
        }

        // Identity must be resolvable (substrate boundary A5)
        if (
          config.unresolvableIdentities !== undefined &&
          config.unresolvableIdentities.has(recipient)
        ) {
          return yield* Effect.fail(
            RewardIdentityUnresolvable.make({ identity_id: recipient }),
          );
        }

        // Optional one-shot failure (FR-4.2 retryable=true/false models)
        const failingGrant = consumeFailingGrant(recipient);
        if (failingGrant !== null) {
          return yield* Effect.fail(
            RewardGrantFailed.make({
              reward_intent: reward,
              reason: failingGrant.reason,
              retryable: failingGrant.retryable,
            }),
          );
        }

        // Happy path: synthesize RewardGranted record + persist
        const grantedEventId = grantedEventIdProvider();
        const record: RewardGrantedRecord = {
          _tag: "RewardGranted",
          reward,
          originating_event_id: originatingEventId,
          granted_event_id: grantedEventId,
          ts: timestampProvider() as RewardGrantedRecord["ts"],
        };
        grants.set(key, record);
        const recipientKey = recipient as unknown as string;
        const list = grantsByRecipient.get(recipientKey) ?? [];
        list.push(record);
        grantsByRecipient.set(recipientKey, list);
        return record;
      }) as Effect.Effect<RewardGrantedRecord, RewardError>,

    query: (identity: IdentityId) =>
      Effect.gen(function* () {
        const failureReason = consumeSimulatedFailure("query");
        if (failureReason !== null) {
          return yield* Effect.fail(
            RewardAdapterUnavailable.make({ adapter_id: adapterId, reason: failureReason }),
          );
        }
        const list = grantsByRecipient.get(identity as unknown as string) ?? [];
        return list.slice() as ReadonlyArray<RewardGrantedRecord>;
      }),
  };

  return {
    port,
    snapshot: () => [...grants.values()],
    clear: () => {
      grants.clear();
      grantsByRecipient.clear();
      counter = 0;
    },
  };
};
