import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

/**
 * apps/runtime vitest config. The root config only globs packages/*; the
 * runtime app needs the `@hyper/*` alias (the vendored hyper core lives under
 * src/hyper/) and the workspace package aliases resolved to SOURCE so route
 * tests (e.g. the defect #21.8 HTTP-status mapping) run without a build step.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@hyper/core": resolve(__dirname, "src/hyper/core/index.ts"),
      "@0xhoneyjar/quests-protocol": resolve(
        __dirname,
        "../../packages/protocol/src/index.ts",
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
