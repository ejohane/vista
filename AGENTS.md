# AGENTS.md

This file is guidance for coding agents working in `vista`.
It documents the commands and coding conventions actually used in this repository.

## Install and Setup

- Install dependencies:
  - `bun install`
- Ensure git hooks are installed (runs on install via `prepare`):
  - `bun run prepare`
- Start full local dev flow (typegen, migrate, seed-if-needed, web + sync workers):
  - `bun run dev`
- Start the full local dev flow from a non-`main` git worktree:
  - `bun run dev:worktree`
- Use `bun run dev` in the main worktree and `bun run dev:worktree` in secondary worktrees so local ports, `.env.local`, and Wrangler state are isolated safely.
- Start dev without seeding demo data:
  - `bun run dev:empty`

## Build, Lint, Typecheck, Test

- Build everything:
  - `bun run build`
- Build only web:
  - `bun run build:web`
- Build only sync worker:
  - `bun run build:sync`
- Generate Cloudflare types for apps:
  - `bun run cf-typegen`
- Lint (Biome checks):
  - `bun run lint`
- Format entire repo:
  - `bun run format`
- Typecheck all workspaces:
  - `bun run typecheck`
- Run full test suite:
  - `bun run test`
- Run pre-commit gate locally (same as git hook):
  - `bun run precommit`

## Running a Single Test (Important)

- Run one test file (recommended):
  - `bun test apps/web/app/routes/home.test.tsx`
  - `bun test packages/db/src/schema.test.ts`
- Run multiple specific files:
  - `bun test apps/sync/src/index.test.ts packages/plaid/src/index.test.ts`
- Run tests by test-name regex:
  - `bun test --test-name-pattern "renders the redesigned product-first dashboard"`
- Run one file + one test name pattern:
  - `bun test apps/web/app/routes/home.test.tsx --test-name-pattern "chart pending"`
- Run tests in watch-like iteration (re-run manually; Bun has no native watch in this script setup):
  - repeat `bun test <path> --test-name-pattern "..."`

## Database and Local Infra Commands

- Re-initialize a secondary worktree's linked env and local worker state:
  - `bun run dev:worktree`
- Generate Drizzle migrations from schema:
  - `bun run db:generate`
- Apply local D1 migrations:
  - `bun run db:migrate:local`
- Seed local D1 demo data:
  - `bun run db:seed:local`
- Reset local dev environment:
  - `bun run dev:reset`

## Cursor / Copilot Rule Files

At the time this file was generated, these files were **not** present:

- `.cursor/rules/`
- `.cursorrules`
- `.github/copilot-instructions.md`

If any are added later, update this AGENTS.md and follow those rules as higher-priority repository instructions.

## Code Style and Conventions

### Formatting and imports

- Use Biome defaults as enforced by `biome.json`.
- Indentation: spaces (Biome-managed).
- Prefer double quotes and trailing commas (Biome output style).
- Keep import groups in this order with one blank line between groups:
  1) external packages,
  2) internal aliases (for web, `@/...`),
  3) relative imports.
- Prefer `import type` for type-only imports.
- In mixed imports, inline `type` specifiers are common and acceptable (e.g. `{ fn, type T }`).

### TypeScript and types

- The repo uses strict TypeScript; keep code `tsc`-clean.
- Prefer explicit unions for state/status values (often derived from `as const` arrays).
- Preserve existing domain types and literal unions (`ProviderType`, `SyncRunStatus`, etc.).
- Use `null | T`/`T | null` deliberately where schema or API can return null.
- Avoid `any`; use narrow types and helper type aliases for complex objects.
- Use `satisfies` where it improves structural guarantees without widening.

### Naming conventions

- `camelCase` for functions/variables.
- `PascalCase` for React components and exported type aliases/interfaces.
- `UPPER_SNAKE_CASE` for true constants (especially env/config constants).
- Use descriptive suffixes aligned with existing code:
  - monetary integers: `*Minor`
  - timestamp/date-ish strings: `*At`, `*Date`
  - IDs: `*Id`

### React / web patterns

- Prefer small, composable function components.
- Keep route logic in route files and shared view logic in `app/lib` or `app/components`.
- Reuse shared UI primitives from `app/components/ui`.
- Use `cn(...)` utility for class merging.
- Favor server-render-friendly tests (`renderToStaticMarkup`) for route rendering checks.

### Sync worker / provider patterns

- Keep provider sync logic deterministic and idempotent where possible.
- Build stable synthetic IDs with provider-prefixed namespaces (e.g. `acct:plaid:...`).
- Keep currency math in minor units (integers), never float storage.
- Normalize provider-specific data before writing canonical tables.
- Use UTC-safe date handling for snapshots and reporting boundaries.

### Data access and SQL

- Drizzle schema in `packages/db/src/schema.ts` is the source of truth.
- For direct D1 SQL, use prepared statements with `.bind(...)`.
- Keep SQL readable with multiline templates and explicit selected columns.
- Preserve table/column naming patterns already in use.

### Error handling and logging

- Throw `Error` with concrete, actionable messages.
- Fail fast on invalid external/provider inputs.
- Validate assumptions close to boundaries (env vars, provider payloads, URL formats).
- Prefer structured JSON logs in workers for sync results.
- Avoid swallowing exceptions silently.

### Testing conventions

- Use `bun:test` (`describe`, `test`, `expect`).
- Prefer focused unit tests near the code under test (`*.test.ts` / `*.test.tsx`).
- Assert product-facing copy and key values for route rendering tests.

## Agent Workflow Expectations

- Before finishing, run the narrowest relevant checks first (targeted test, then broader checks).
- For substantial changes, run at least:
  - `bun run lint`
  - `bun run typecheck`
  - `bun run test` (or clearly explain why a narrower run was used)
- Do not commit generated local secrets/vars files (for example `.dev.vars`).
- Keep changes minimal and consistent with existing architecture.
