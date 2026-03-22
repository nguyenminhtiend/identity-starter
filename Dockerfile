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

# Install all dependencies (including dev for build step)
RUN pnpm install --frozen-lockfile

# =============================================================================
# Stage 2: Build
# =============================================================================
FROM deps AS build

# Copy source code
COPY packages/ ./packages/
COPY apps/server/ ./apps/server/
COPY turbo.json ./

# Build all packages (packages/* via tsc, server via tsup)
RUN pnpm turbo build

# Reinstall production dependencies only (pnpm prune is unreliable with workspaces)
ENV CI=true
RUN pnpm install --prod --frozen-lockfile

# =============================================================================
# Stage 3: Production
# =============================================================================
FROM node:24-slim AS production

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# Security: run as non-root
RUN groupadd --system appgroup && \
    useradd --system --gid appgroup --create-home appuser

WORKDIR /app

# Copy production node_modules from build stage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/packages/db/node_modules ./packages/db/node_modules

# Copy built server bundle
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/

# Copy migration files (needed for init container / migrate step)
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=build /app/packages/db/package.json ./packages/db/

# Copy migration script
COPY scripts/migrate.sh ./scripts/

# Set ownership
RUN chown -R appuser:appgroup /app

USER appuser

# Ensure external packages bundled by tsup are resolvable from the server
# (pnpm symlinks are lost during COPY, so postgres needs an explicit link)
RUN ln -s /app/packages/db/node_modules/postgres /app/apps/server/node_modules/postgres

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "apps/server/dist/server.js"]
