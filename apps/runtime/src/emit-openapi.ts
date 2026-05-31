/**
 * emit-openapi.ts — headless OpenAPI 3.1 emit (no listen).
 *
 * `bun run apps/runtime/src/emit-openapi.ts [out.json]` builds the app graph
 * and prints (or writes) the OpenAPI spec. Used by T-A4 (freeside-cli doctor /
 * CI) to emit the spec artifact without booting a server — the route graph is
 * the single source (one decl → handler + this spec).
 *
 * Imports the app with HYPER_SKIP_LISTEN so importing ./server.ts does NOT
 * start a listener even though it has an `import.meta.main` guard (this module
 * is the entry, not server.ts, so the guard is already false — but the env is
 * belt-and-suspenders for any future refactor).
 */

process.env.HYPER_SKIP_LISTEN = "1";

import app from "./server";

const spec = app.toOpenAPI({ title: "activities-api", version: "0.1.0" });
const out = process.argv[2];
const json = JSON.stringify(spec, null, 2);

if (out !== undefined) {
  await Bun.write(out, json);
  console.log(`wrote OpenAPI spec → ${out}`);
} else {
  console.log(json);
}
