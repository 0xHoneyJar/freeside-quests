/**
 * Health route — public, no auth, no MCP exposure. The canonical liveness
 * probe (SDD §5 · FR-A1 · G-1). A container healthcheck hits this; it only
 * succeeds if the listener bound to 0.0.0.0 (see ../server.ts).
 *
 * Also surfaces a coarse `db` signal: "connected-url-present" when a
 * DATABASE_URL is wired, "degraded-no-db" otherwise. This is liveness, NOT
 * readiness — /health stays 200 even with no DB so the platform considers the
 * container healthy while the cubquest-db binding is still pending (T-A5).
 */

import { ok } from "@hyper/core";
import { route } from "../app";
import type { Composition } from "../composition";

export const makeHealthRoute = (composition: Composition) =>
  route
    .get("/health")
    .meta({ name: "health", tags: ["ops"] })
    .handle(() =>
      ok({
        ok: true as const,
        service: "activities-api",
        plane: "read" as const,
        db:
          composition.surface !== null
            ? ("configured" as const)
            : ("degraded-no-db" as const),
        db_source: composition.source,
      }),
    );
