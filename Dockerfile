# Goldwave Casino — API image (shared by the web + worker services on Railway).
# Multi-stage: install workspace deps, build shared/db/api, then a lean runtime
# that still carries the Prisma CLI + migrations so `prisma migrate deploy` can
# run as the Railway pre-deploy step.

# ---- base -------------------------------------------------------------------
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# openssl is required by Prisma's query engine at runtime.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
WORKDIR /app

# ---- dependencies (cached on lockfile) --------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
COPY apps/console/package.json apps/console/
COPY apps/arcade/package.json apps/arcade/
RUN pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM deps AS build
COPY . .
# Prisma client, then the packages the API depends on, then the API itself.
RUN pnpm --filter @aureus/db db:generate \
  && pnpm --filter @aureus/shared build \
  && pnpm --filter @aureus/db build \
  && pnpm --filter @aureus/api build

# ---- runtime ----------------------------------------------------------------
# Carry the built workspace + node_modules (incl. the generated Prisma client,
# the Prisma CLI, and the migrations) so both `node dist/*.js` and
# `prisma migrate deploy` work. The web service starts main.js; the worker
# service overrides the start command to worker.js (see railway.worker.toml).
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
