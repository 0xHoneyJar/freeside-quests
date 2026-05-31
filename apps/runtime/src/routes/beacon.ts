/**
 * Beacon route — `GET /.well-known/beacon.json` (SDD §5 · FR-A1 · G-1/G-2).
 *
 * Serves the rendered `packages/protocol/beacon.yaml` as JSON. The 5 declared
 * read capabilities must resolve non-empty (G-2 / IMP-011) — the renderer
 * asserts this at boot; here we serve the parsed object verbatim.
 */

import { ok } from "@hyper/core";
import { route } from "../app";
import { renderBeacon } from "../beacon";

export const beaconRoute = route
  .get("/.well-known/beacon.json")
  .meta({ name: "beacon", tags: ["discovery"] })
  .handle(() => ok(renderBeacon().json));
