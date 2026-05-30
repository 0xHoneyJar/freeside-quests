/**
 * app.ts — the route-builder anchor for the activities runtime.
 *
 * Mirrors identity-api's `src/auth.ts` indirection (every route file imports
 * `route` from here, not directly from `@hyper/core`), so that when auth lands
 * (bearer-JWT via identity-api, SDD §7 Lane B / a later Lane-A write task) the
 * `.auth()` install happens HERE and every route picks it up by import order.
 *
 * Today the READ plane is unauthenticated (the 5 capabilities are public
 * reads per the MCP tool surface — A7 read-only). No JWT install yet; this is
 * a clean re-export. The indirection is the seam that keeps the write-path
 * auth wiring a one-file change.
 */

export { route } from "@hyper/core";
