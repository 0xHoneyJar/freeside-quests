# syntax=docker/dockerfile:1
#
# activities-api HTTP runtime — Hyper-over-Effect read plane (SDD §5/§6).
#
# Base: oven/bun (NOT Nixpacks). Nixpacks struggles with this repo's Bun +
# vendored-`@hyper/*`-alias + tsconfig-paths-to-workspace-`src` resolution
# (the runtime imports `@0xhoneyjar/quests-*` straight from packages/*/src and
# `@hyper/*` from apps/runtime/src/hyper via Bun's TS-aware resolver — there is
# NO build/dist step). Bun runs the TypeScript directly, so the image just
# needs the source tree + a `bun install`.
#
# This Dockerfile builds from the REPO ROOT (the monorepo), because the runtime
# resolves workspace packages by relative path. Build with:
#   docker build -f apps/runtime/Dockerfile -t activities-api .
#
# Railway: set the service's Dockerfile path to apps/runtime/Dockerfile and the
# build context to the repo root (railway.toml does this via [build]).

FROM oven/bun:1.3.13-slim AS base
WORKDIR /app

# ── Install deps. Copy the whole monorepo manifest set so bun links the
#    workspace graph (the runtime depends on protocol/adapters/engine as
#    workspace:* — they must be present for `bun install` to symlink them). ──
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps ./apps
# Frozen lockfile keeps the image reproducible; --production would drop the
# devDeps (effect/pg/typescript) that the runtime needs at RUN time, so we do a
# full install (effect + pg are peer/dev deps the TS imports at runtime).
RUN bun install --frozen-lockfile

# ── The runtime reads the BeaconV3 declaration from packages/protocol/beacon.yaml
#    at request time; it is already present via `COPY packages`. No build step.

# Railway does NOT auto-inject PORT for Dockerfile services — server.ts reads
# process.env.PORT explicitly (default 8787). EXPOSE is documentation only.
ENV NODE_ENV=production
EXPOSE 8787

# Liveness: the canonical /health route (binds 0.0.0.0). Railway uses its own
# healthcheckPath (railway.toml); this HEALTHCHECK is for plain `docker run`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://0.0.0.0:'+(process.env.PORT??8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "apps/runtime/src/server.ts"]
