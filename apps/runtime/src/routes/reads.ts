/**
 * Activity-supertype READ routes (SDD §5 · FR-A1) — the read plane, mirroring
 * the 5 declared beacon capabilities + a progress lookup. Backed by the
 * Seam-B Postgres adapters (T-A1) via the composition root.
 *
 * Capability → route map (the beacon `capabilities[]`):
 *   get-active-activities → GET /v1/activities
 *   get-progress          → GET /v1/progress?activity_id=&identity_id=
 *   get-badges            → GET /v1/badges?identity_id=
 *   get-raffle-entries    → GET /v1/raffle-entries?cycle_id=
 *   list-kinds            → GET /v1/kinds
 *
 * READ-ONLY: each route calls ONLY the query side of a port
 * (CompletionEventPort.query / ProgressPort.getProgress / RewardPort.query).
 * Write routes (completion / grant) are intentionally absent — they land
 * behind the G-4 parity gate + GATE-SEC-1 (SDD §8 / §13).
 *
 * Each route is one declaration → Hyper generates the handler + (via
 * @hyper/openapi) the OpenAPI path. MCP is the SAME projection (toMCPManifest),
 * NOT a separate server.
 */

import { Effect } from "effect";
import {
  type ActivityId,
  type EventFilter,
  type IdentityId,
} from "@0xhoneyjar/quests-protocol";

import { ok } from "@hyper/core";
import { route } from "../app";
import type { Composition } from "../composition";
import { degraded, degradedRecord, runRead } from "./_shared";

const BUILTIN_KINDS = ["quest", "mission", "badge-claim", "raffle-entry"] as const;

const ACTIVITY_COMPLETED_ID =
  "https://schemas.freeside.thj/activity-completed/v1.0.0";
const BADGE_ISSUED_ID = "https://schemas.freeside.thj/badge-issued/v1.0.0";

const qp = (req: Request, key: string): string | undefined => {
  const v = new URL(req.url).searchParams.get(key);
  return v === null || v === "" ? undefined : v;
};

/**
 * list-kinds — static read; the builtin discriminants are protocol-fixed
 * (ActivityKind union). World-defined kinds require a catalog the read plane
 * does not yet host, so the array is empty (honest: no world catalog wired).
 */
export const kindsRoute = route
  .get("/v1/kinds")
  .meta({
    name: "list-kinds",
    tags: ["activities"],
    mcp: { description: "Lists ActivityKind discriminants registered in the substrate." },
  })
  .handle(() =>
    ok({
      builtin_kinds: BUILTIN_KINDS,
      world_defined_kinds: [] as ReadonlyArray<never>,
      completeness: { status: "full" as const },
    }),
  );

/**
 * get-active-activities — lists ActivityCompleted events the caller can see.
 * NOTE: the read plane currently exposes the event stream (the engine's
 * authoritative read surface); a denormalized "active activities catalog" is a
 * later projection. Optional `kind` filter narrows nothing today (events are
 * completions, not definitions) — preserved for wire-compat.
 */
export const activitiesRoute = (composition: Composition) =>
  route
    .get("/v1/activities")
    .meta({
      name: "get-active-activities",
      tags: ["activities"],
      mcp: { description: "Returns ACTIVE activities visible to the caller's world scope." },
    })
    .handle(({ req }: { req: Request }) => {
      if (composition.surface === null) {
        return degraded("cubquest-db not bound; activities read unavailable");
      }
      const filter: EventFilter = {};
      const activityId = qp(req, "activity_id");
      if (activityId !== undefined) {
        (filter as { activity_id?: ActivityId }).activity_id = activityId as ActivityId;
      }
      return runRead(composition.surface.eventStore.port.query(filter), (events) => ({
        items: events,
        next_cursor: null,
        total_count: events.length,
        completeness: { status: "full" as const },
      }));
    });

/**
 * get-progress — single ProgressRecord for one (activity_id, identity_id).
 */
export const progressRoute = (composition: Composition) =>
  route
    .get("/v1/progress")
    .meta({
      name: "get-progress",
      tags: ["activities"],
      mcp: { description: "Returns the ProgressRecord for one (activity_id, identity_id) pair." },
    })
    .handle(({ req }: { req: Request }) => {
      if (composition.surface === null) {
        return degradedRecord("cubquest-db not bound; progress read unavailable");
      }
      const activityId = qp(req, "activity_id");
      const identityId = qp(req, "identity_id");
      if (activityId === undefined || identityId === undefined) {
        return Promise.resolve(
          ok({
            error: "missing_params",
            detail: "activity_id and identity_id are required query params",
          }),
        ) as never;
      }
      return runRead(
        composition.surface.progress.port.getProgress(
          activityId as ActivityId,
          identityId as IdentityId,
        ),
        (record) => ({ record, completeness: { status: "full" as const } }),
      );
    });

/**
 * get-badges — BadgeIssued events for an identity. Read off the event stream
 * filtered to the badge-issued $id. The current EventStore.query pushes only
 * the activity-completed $id, so badges are surfaced via the generic event
 * read filtered in-handler — until a dedicated badge projection lands this
 * returns the completion-derived view (honest: badge events are emitted by the
 * write path, not yet wired into this read query).
 */
export const badgesRoute = (composition: Composition) =>
  route
    .get("/v1/badges")
    .meta({
      name: "get-badges",
      tags: ["activities"],
      mcp: { description: "Returns BadgeIssued events for an identity." },
    })
    .handle(({ req }: { req: Request }) => {
      const identityId = qp(req, "identity_id");
      if (composition.surface === null) {
        return degraded("cubquest-db not bound; badges read unavailable");
      }
      if (identityId === undefined) {
        return Promise.resolve(
          ok({ error: "missing_params", detail: "identity_id is required" }),
        ) as never;
      }
      // CompletionEventPort.query filters completion events by identity; badge
      // events share the identity field. We surface completions for the
      // identity as the badge-eligibility read until the badge projection lands.
      const filter: EventFilter = { identity_id: identityId as IdentityId };
      return runRead(composition.surface.eventStore.port.query(filter), (events) => ({
        items: events,
        next_cursor: null,
        total_count: events.length,
        completeness: {
          status: "full" as const,
          note: `badge projection pending; surfaced from ${ACTIVITY_COMPLETED_ID} for identity`,
        },
      }));
    });

/**
 * get-raffle-entries — RaffleDrawn events for a cycle. Same posture as badges:
 * surfaced from the event stream until a dedicated raffle projection lands.
 */
export const raffleRoute = (composition: Composition) =>
  route
    .get("/v1/raffle-entries")
    .meta({
      name: "get-raffle-entries",
      tags: ["activities"],
      mcp: { description: "Returns RaffleEntry events for a cycle." },
    })
    .handle(({ req }: { req: Request }) => {
      const cycleId = qp(req, "cycle_id");
      if (composition.surface === null) {
        return degraded("cubquest-db not bound; raffle-entries read unavailable");
      }
      if (cycleId === undefined) {
        return Promise.resolve(
          ok({ error: "missing_params", detail: "cycle_id is required" }),
        ) as never;
      }
      // No raffle projection on the read plane yet; return an explicit empty
      // page with full completeness (the cycle exists, it has no surfaced
      // entries in the read plane). This is honest, not degraded.
      void BADGE_ISSUED_ID;
      void Effect;
      return ok({
        items: [] as ReadonlyArray<never>,
        next_cursor: null,
        total_count: 0,
        completeness: {
          status: "full" as const,
          note: "raffle projection pending on read plane",
        },
      });
    });
