# Phase 8: Build, Bundle & Deployment — Overview

> **For agentic workers:** Each sub-plan (8a, 8b, 8c) is an independent implementation plan. Execute them in order using superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Transform the identity-starter server from a development-only tsc build into a production-optimized, containerized, CI/CD-automated deployment pipeline.

**Architecture:** tsup bundles the server with workspace deps inlined and node_modules externalized. Multi-stage Docker builds produce a minimal node:24-slim image running as non-root. GitHub Actions automates lint → test → build → Docker push → release via changesets.

**Tech Stack:** tsup (esbuild), Docker (multi-stage, node:24-slim), docker-compose, GitHub Actions, @changesets/cli, ghcr.io

---

## Sub-Plans

| Plan | Scope | Dependencies |
|------|-------|-------------|
| [Phase 8a: Build & Bundle](./2026-03-22-phase-8a-build-bundle.md) | tsup config, production build scripts, graceful shutdown, Pino JSON logging | None |
| [Phase 8b: Docker & Compose](./2026-03-22-phase-8b-docker-compose.md) | Multi-stage Dockerfile, .dockerignore, docker-compose.yml, health check, migration init script, .env.production.example | 8a (needs tsup build) |
| [Phase 8c: CI/CD Pipeline](./2026-03-22-phase-8c-cicd-pipeline.md) | GitHub Actions (PR checks, Docker build+push, integration tests with Postgres), changesets release automation | 8a + 8b |

## Key Decisions (from interview)

- **Bundler:** tsup — bundle workspace deps, externalize node_modules
- **Docker base:** node:24-slim (Debian, no musl issues with argon2)
- **Deploy target:** Docker + VPS/Cloud (Railway, Fly.io, AWS ECS, etc.)
- **Frontend:** Not in scope — BE-focused
- **CI/CD:** GitHub Actions (full pipeline)
- **Registry:** GitHub Container Registry (ghcr.io)
- **Migrations:** Init container / pre-deploy step
- **Compose:** Full (Postgres + Redis + server)
- **Secrets:** Docker env + .env files
- **Health check:** Single /health endpoint (enhanced)
- **Graceful shutdown:** Full (SIGTERM, connection draining, resource cleanup)
- **Logging:** Pino JSON in production, pino-pretty in dev (already configured)
- **Versioning:** Single version for all packages via changesets
- **Non-root Docker user:** Yes
- **Remote cache:** Skip (GitHub Actions cache only)
