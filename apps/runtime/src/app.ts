/**
 * app.ts — the route-builder anchor for the activities runtime.
 *
 * Mirrors identity-api's `src/auth.ts` indirection (every route file imports
 * `route` from here, not directly from `@hyper/core`), so the auth install is
 * a single-file change and every route picks it up by import.
 *
 * AUTH (now wired — #21 read-plane review, CRITICAL "before-public-exposure"):
 * the READ plane is NO LONGER public. Every DATA route requires a valid
 * identity-api Bearer JWT (HS256, iss=identity-api). `/health` and
 * `/.well-known/beacon.json` stay public (liveness + discovery).
 *
 * The gate is a middleware (`requireIdentity`) rather than the Hyper
 * `.auth()` prototype sugar: `.auth()` is a freeside-auth-side install over
 * a vendored hyper plugin we don't ship here, and the middleware form lets the
 * route handler read the AUTHENTICATED identity back via `identityOf(req)`
 * (request-scoped). Routes apply it with `.use(requireIdentity)`.
 *
 * The middleware is built from env at module load (resolveAuthConfig →
 * makeRequireIdentity) so route files can import a ready singleton. The secret
 * comes from IDENTITY_API_JWT_SECRET — fail-closed if unset (every data read
 * 401s rather than serving unauthenticated).
 */

import { makeRequireIdentity, resolveAuthConfig } from "./auth/require-identity";

export { route } from "@hyper/core";
export { identityOf } from "./auth/require-identity";
export type { VerifiedIdentity } from "./auth/jwt-verify";

/**
 * requireIdentity — the configured read-plane auth gate. Apply to every data
 * route via `.use(requireIdentity)`. Public routes (health/beacon) omit it.
 */
export const requireIdentity = makeRequireIdentity(resolveAuthConfig());
