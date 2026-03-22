# Phase 8c: CI/CD Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate lint, test, build, Docker image publishing, and release management with GitHub Actions and changesets.

**Architecture:** Three GitHub Actions workflows: (1) PR checks (lint + typecheck + unit test + integration test with Postgres + build), (2) Docker build and push to ghcr.io on merge to main, (3) Changesets-based release automation with single-version strategy.

**Tech Stack:** GitHub Actions, @changesets/cli, ghcr.io, Postgres service container

**Depends on:** Phase 8a (tsup build) + Phase 8b (Dockerfile)

> **Note:** Replace all occurrences of `YOUR_GITHUB_USERNAME` in this plan with your actual GitHub username or organization name before executing.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `.github/workflows/ci.yml` | Create | PR checks: lint, typecheck, test (unit + integration), build |
| `.github/workflows/docker.yml` | Create | Build and push Docker image on merge to main |
| `.github/workflows/release.yml` | Create | Changesets version bump + release |
| `.changeset/config.json` | Create | Changesets configuration (fixed versioning) |
| `package.json` (root) | Modify | Add changeset scripts |

---

### Task 1: Create PR checks workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the .github/workflows directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Create the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: "24"
  PNPM_VERSION: "10.32.1"

jobs:
  lint:
    name: Lint & Typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Biome lint
        run: pnpm lint

      - name: Build packages (needed for typecheck)
        run: pnpm turbo build --filter='./packages/*'

      - name: Typecheck
        run: pnpm typecheck

  test-unit:
    name: Unit Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Build packages
        run: pnpm turbo build --filter='./packages/*'

      - name: Run unit tests
        run: pnpm --filter server test:unit

  test-integration:
    name: Integration Tests
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: identity_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U test -d identity_test"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Build packages
        run: pnpm turbo build --filter='./packages/*'

      - name: Run integration tests
        run: pnpm --filter server test:integration
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/identity_test

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: [lint, test-unit, test-integration]
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Build all
        run: pnpm turbo build

      - name: Verify server bundle exists
        run: test -f apps/server/dist/server.js
```

> **Key design decisions:**
> - **Parallel jobs:** lint, test-unit, test-integration run in parallel. Build runs after all pass.
> - **Postgres service container:** Real database for integration tests, matching local dev.
> - **pnpm cache:** `actions/setup-node` with `cache: pnpm` caches the pnpm store.
> - **concurrency:** Cancels in-progress runs for the same branch (saves CI minutes).
> - **Separate lint + test jobs:** Faster feedback — lint failures show instantly without waiting for tests.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add PR checks workflow (lint, typecheck, test, build)"
```

---

### Task 2: Create Docker build and push workflow

**Files:**
- Create: `.github/workflows/docker.yml`

- [ ] **Step 1: Create the Docker workflow**

Create `.github/workflows/docker.yml`:

```yaml
name: Docker

on:
  push:
    branches: [main]
    tags: ["v*"]

concurrency:
  group: docker-${{ github.ref }}
  cancel-in-progress: true

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push:
    name: Build & Push Docker Image
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata (tags, labels)
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=sha,prefix=
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest,enable={{is_default_branch}}

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

> **Key design decisions:**
> - **Triggers:** Push to main (latest tag) + version tags (v1.0.0 → semver tags).
> - **GITHUB_TOKEN:** No secrets needed — uses built-in token for ghcr.io.
> - **Docker Buildx:** Enables build cache via GitHub Actions cache (`type=gha`). Dramatically speeds up subsequent builds.
> - **Tag strategy:** `latest` on main, git SHA for traceability, semver on release tags.
> - **Metadata action:** Standard way to generate Docker tags from git context.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/docker.yml
git commit -m "ci: add Docker build and push workflow to ghcr.io"
```

---

### Task 3: Set up changesets for release automation

**Files:**
- Create: `.changeset/config.json`
- Modify: `package.json` (root)

- [ ] **Step 1: Install changesets**

```bash
pnpm add -Dw @changesets/cli @changesets/changelog-github
```

- [ ] **Step 2: Create changesets config**

Create `.changeset/config.json`:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.1/schema.json",
  "changelog": [
    "@changesets/changelog-github",
    { "repo": "YOUR_GITHUB_USERNAME/identity-starter" }
  ],
  "commit": false,
  "fixed": [
    [
      "@identity-starter/server",
      "@identity-starter/core",
      "@identity-starter/db",
      "@identity-starter/redis"
    ]
  ],
  "linked": [],
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

> **`fixed` array:** All packages share a single version number. When any package gets a changeset, all packages bump together. This is the "single version" strategy you chose.

> **`changelog`:** Uses `@changesets/changelog-github` for rich changelog entries with PR links and author attribution. Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username/org.

> **`commit: false`:** Changesets won't auto-commit — you control when to commit version bumps.

- [ ] **Step 3: Create .changeset/README.md (required by changesets)**

Create `.changeset/README.md`:

```markdown
# Changesets

This project uses [changesets](https://github.com/changesets/changesets) for version management.

## Adding a changeset

```bash
pnpm changeset
```

Follow the prompts to describe your change. Changesets are committed with your PR.

## Releasing

The release workflow automatically creates a "Version Packages" PR when changesets accumulate on main. Merging that PR publishes the release.
```

- [ ] **Step 4: Add changeset scripts to root package.json**

In root `package.json`, add to scripts:

```json
{
  "scripts": {
    "changeset": "changeset",
    "version": "changeset version",
    "release": "changeset publish"
  }
}
```

- [ ] **Step 5: Verify changesets setup**

```bash
pnpm changeset status
```

Expected: "No changesets present" (clean state).

- [ ] **Step 6: Commit**

```bash
git add .changeset/ package.json pnpm-lock.yaml
git commit -m "feat(release): set up changesets for single-version release management"
```

---

### Task 4: Create release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the release workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    branches: [main]

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  release:
    name: Version & Release
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    env:
      NODE_VERSION: "24"
      PNPM_VERSION: "10.32.1"
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Create Release PR or Tag Release
        uses: changesets/action@v1
        with:
          version: pnpm version
          publish: pnpm release
          title: "chore(release): version packages"
          commit: "chore(release): version packages"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

> **How it works:**
> 1. Developer adds changesets with `pnpm changeset` during development.
> 2. On push to main, if pending changesets exist, the action creates/updates a "Version Packages" PR.
> 3. The PR bumps versions in all package.json files and updates CHANGELOG.md.
> 4. When the PR is merged, the action tags the release and creates a GitHub Release.
> 5. The `v*` tag triggers the Docker workflow to build and push a semver-tagged image.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add changesets release automation workflow"
```

---

### Task 5: Add a sample changeset for Phase 8

**Files:**
- Create: `.changeset/<generated-name>.md`

- [ ] **Step 1: Create a changeset manually**

Create `.changeset/phase-8-build-deploy.md`:

```markdown
---
"@identity-starter/server": minor
---

Add production build pipeline (tsup), Docker containerization, and CI/CD automation
```

> This changeset will be consumed by the release workflow. When the "Version Packages" PR is merged, it bumps the version from 0.0.1 to 0.1.0 across all packages (minor bump, fixed versioning).

- [ ] **Step 2: Verify changeset status**

```bash
pnpm changeset status
```

Expected: Shows 1 changeset affecting `@identity-starter/server` (minor).

- [ ] **Step 3: Commit**

```bash
git add .changeset/phase-8-build-deploy.md
git commit -m "chore: add changeset for phase 8 release"
```

---

### Task 6: Verify full CI pipeline locally

- [ ] **Step 1: Run the full CI check sequence locally**

```bash
# Step 1: Lint
pnpm lint

# Step 2: Build packages
pnpm turbo build --filter='./packages/*'

# Step 3: Typecheck
pnpm typecheck

# Step 4: Unit tests
pnpm --filter server test:unit

# Step 5: Integration tests (needs local Postgres)
pnpm --filter server test:integration

# Step 6: Full build (including tsup server bundle)
pnpm turbo build

# Step 7: Verify bundle exists
test -f apps/server/dist/server.js && echo "OK: server bundle exists" || echo "FAIL: no server bundle"

# Step 8: Docker build
docker build -t identity-starter:ci-test .
```

Expected: All steps pass. This mirrors exactly what CI will run.

- [ ] **Step 2: Test Docker compose full stack**

```bash
docker compose up --build -d
sleep 10
curl http://localhost:3000/health
docker compose down
```

Expected: `{"status":"ok","checks":{"database":"ok"}}`

- [ ] **Step 3: Final commit (if any cleanup needed)**

```bash
git status
# If clean, no commit needed
```

---

## Completion Criteria

- [ ] `.github/workflows/ci.yml` — PR checks (lint, typecheck, unit test, integration test with Postgres, build)
- [ ] `.github/workflows/docker.yml` — Docker build + push to ghcr.io on main/tags
- [ ] `.github/workflows/release.yml` — Changesets release automation
- [ ] `.changeset/config.json` — Fixed versioning across all packages
- [ ] `pnpm changeset` works to create new changesets
- [ ] Full CI check sequence passes locally
- [ ] Docker image builds in CI-like conditions
- [ ] All existing tests pass

## Post-Deployment Checklist

After pushing to GitHub:

- [ ] Verify CI workflow runs on PR
- [ ] Verify Docker workflow runs on merge to main
- [ ] Check ghcr.io for published image
- [ ] Test pulling and running the published image:
  ```bash
  docker pull ghcr.io/YOUR_GITHUB_USERNAME/identity-starter:latest
  ```
- [ ] Create first release by merging the "Version Packages" PR
