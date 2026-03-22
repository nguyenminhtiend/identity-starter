# =============================================================================
# Stage 1: Install dependencies
# =============================================================================
FROM node:24-slim AS deps

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

# Copy workspace config files first (better layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/redis/package.json ./packages/redis/
COPY packages/ui/package.json ./packages/ui/

RUN pnpm install --frozen-lockfile

# =============================================================================
# Stage 2: Build
# =============================================================================
FROM deps AS build

COPY packages/ ./packages/
COPY apps/server/ ./apps/server/
COPY turbo.json ./

RUN pnpm turbo build

# Deploy server with flat, production-only node_modules (no pnpm symlinks)
ENV CI=true
RUN pnpm --filter @identity-starter/server deploy --legacy /app/deployed --prod

# =============================================================================
# Stage 3: Production
# =============================================================================
FROM node:24-slim AS production

RUN groupadd --system appgroup && \
    useradd --system --gid appgroup --create-home appuser

WORKDIR /app

# Copy deployed server (flat node_modules with prod deps only)
COPY --from=build /app/deployed/node_modules ./node_modules
COPY --from=build /app/deployed/dist ./dist
COPY --from=build /app/deployed/package.json ./

# Copy migration files (needed for init container / migrate step)
# migrate.js resolves drizzle-orm + postgres from /app/node_modules
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=build /app/packages/db/package.json ./packages/db/

COPY scripts/ ./scripts/

RUN chown -R appuser:appgroup /app

USER appuser

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
