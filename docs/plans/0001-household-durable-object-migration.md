# Plan 0001: Household Durable Object Migration

- Status: In Progress
- Date: 2026-04-11
- Related:
  - `docs/adr/0001-data-ingestion-strategy.md`
  - `docs/adr/0002-normalized-data-model-and-sync-workflow.md`
  - `docs/blueprint/0001-v1-repository-blueprint.md`

## Summary

Vista should migrate from a shared D1-centric canonical data model to a household-first isolation model built around one Durable Object per household.

The primary motivation for this move is isolation, not raw scale. Vista is financial planning software, so the architecture should make the household boundary explicit and enforceable in both reads and writes.

The target model is:

- one `HouseholdState` Durable Object per household
- household-local canonical finance data stored inside the object's SQLite-backed storage
- a small shared control plane outside the object for membership, routing, and global orchestration metadata
- web and sync runtimes communicating with household state through a narrow service boundary instead of directly reading and writing shared D1 tables

## Implementation Progress

Implemented in the current branch on 2026-04-12:

- Phase 1 is complete for the current D1-based system boundary.
- Phase 2 is complete for home, portfolio, account review, connect Plaid, and sync-worker read paths.
- Phase 3 is complete with a dedicated `apps/state` worker and `HouseholdState` Durable Object runtime.
- Phase 4 is complete behind `HOUSEHOLD_STATE_MODE=dual` for account curation, scheduled sync, fixture ingest, and Plaid onboarding writes.
- Phase 5 is complete behind `HOUSEHOLD_STATE_MODE=state|dual` for home, portfolio, account review, and sync-worker dashboard reads.
- Phase 6 is implemented for the current product surface behind `HOUSEHOLD_STATE_MODE=state`, while keeping legacy D1 hydration and rollback scaffolding available.

Completed work:

- added an explicit household selection layer backed by shared D1 household lookup
- removed the hardcoded `household_default` onboarding path in Plaid connect flows and now provision household ids dynamically when no household exists yet
- made multi-household ambiguity fail fast unless a `householdId` is supplied explicitly
- introduced a D1-backed `HouseholdService` boundary for homepage, portfolio, account curation, and dashboard snapshot reads
- updated web routes and redirects to preserve `householdId` in scoped navigation
- updated the sync worker read path to resolve a household explicitly before loading snapshot data
- added `packages/household-state` with a D1-shaped Durable Object SQLite adapter, typed state export/import, RPC client, mode handling, and a runtime household service
- added `apps/state` with a `HouseholdState` Durable Object, household-local SQLite schema, and HTTP endpoints for snapshot reads, curation writes, fixture ingest, provider connection writes, and Plaid sync execution
- wired local dev, workspace scripts, and Wrangler bindings so web and sync runtimes can talk to the state worker directly
- moved homepage, portfolio, account review, and sync dashboard reads behind a mode-aware runtime service with parity logging during dual-read validation
- added dual-write and state-write support for account curation, scheduled Plaid sync, demo fixture ingest, and Plaid onboarding first-sync flows
- kept provider connection registry data in shared D1 while allowing state mode to avoid persisting Plaid access tokens there for newly connected households

Verification completed:

- red/green TDD for household selection, state-store import/export parity, fixture ingest idempotency, Plaid onboarding, route loaders/actions, and explicit-household DB helpers
- targeted Bun test runs covering the state store, sync worker, fixture ingest, and Plaid route/helper flows
- manual runtime verification of the home loader, account review flow, and Plaid redirect flow against seeded local data / in-memory D1 shims
- repo-wide lint, typecheck, and test validation are the final branch-level verification step before publishing

## Why This Move

The current implementation is effectively single-household and shared-database-first.

Observed characteristics in the current codebase:

- household creation and lookup currently default to the first or only household
- onboarding uses a default household id
- web routes read directly from D1-backed shared query helpers
- sync code writes directly to the same shared D1-backed model
- local development intentionally shares state between web and sync workers

That model is workable for early prototyping, but it is weaker than desired for a finance product because:

- tenant boundaries are implicit rather than enforced
- mistakes in routing or query scoping can expose the wrong household's data
- background sync and UI mutations are serialized only by convention, not by architecture
- future multi-household support would require careful query hygiene everywhere

Durable Objects are a good fit here because they provide:

- a natural serialization boundary per household
- strong isolation for household-local data and sync state
- a simpler mental model for concurrency-sensitive finance mutations
- a way to make "household" the default storage and execution unit across the product

## Goals

1. Make household identity explicit across the application.
2. Enforce household isolation in the storage model, not only in application code.
3. Preserve the current product model: household-first dashboard, portfolio, and account curation.
4. Keep migration risk low through staged rollout and rollback paths.
5. Avoid rewriting product logic and sync logic more than necessary.
6. Maintain a local development workflow that remains easy to run and reason about.

## Non-Goals

- optimizing for extreme horizontal scale before it is needed
- introducing a microservice-heavy architecture
- redesigning the product UX as part of the storage migration
- changing providers or rewriting ingestion logic purely for architectural neatness
- eliminating all shared/global data stores

## Architectural Decision

The isolation unit should be the household, not the individual user and not the provider connection.

Reasons:

- Vista is a household-first product
- ownership and visibility rules exist inside a household, not across separate user silos
- home, portfolio, and account review are naturally household-scoped views
- per-user storage would force cross-user coordination for shared finances
- per-connection storage would reintroduce joins and reconciliation at the household layer

## Target Architecture

The target runtime has three layers:

1. control plane
2. household state plane
3. product and sync entrypoints

### 1. Control Plane

This is a small shared data store, likely still D1, responsible for global routing and metadata.

It should own:

- household registry
- household membership records
- mapping from authenticated user to household ids
- mapping from provider connection id to household id
- mapping from external provider identity to household id when needed for webhooks or callbacks
- high-level sync scheduling metadata if it is not fully household-local

It should not own household-local canonical finance state.

### 2. Household State Plane

This is a dedicated worker exposing a Durable Object class such as `HouseholdState`.

Each household object should own:

- canonical accounts
- account curation state
- balance snapshots
- holdings and holding snapshots
- household-local sync runs
- household-local checkpoints or reconciliation metadata
- household-local reporting read models or derived facts
- provider access secrets if the team chooses to keep secrets strictly household-local

The object's SQLite storage becomes the source of truth for household-local finance state.

### 3. Product and Sync Entry Points

The web worker and sync worker should stop reading and writing household finance tables directly.

Instead:

- the web worker resolves the active household id from the control plane, then calls the `HouseholdState` object
- the sync worker resolves which household to sync, then calls the `HouseholdState` object to perform the sync or apply normalized writes
- both workers talk to household state through explicit methods, not through raw SQL pass-through

## Recommended Repository Shape

The current repo can evolve without a major re-layout, but the target shape should add a dedicated state runtime.

Recommended addition:

```text
apps/
  state/
    src/
      index.ts
      household-state.ts
      household-store/
      rpc/
    package.json
    tsconfig.json
    wrangler.jsonc
```

Suggested responsibility split:

- `apps/web`: UI, auth-aware request handling, user mutations via household service
- `apps/sync`: cron and provider sync orchestration, calls into household service
- `apps/state`: household Durable Object runtime and household-local persistence
- `packages/db`: control-plane schema and query helpers only, after migration
- `packages/plaid`: provider client and normalization helpers, without assuming shared D1 as the canonical target

## Data Ownership Split

### Shared Control Plane Data

Keep globally shared and non-household-local routing data in shared D1.

Examples:

- `households`
- `household_memberships`
- `provider_connections_registry`
- external provider connection lookup tables
- auth-to-household resolution tables

This data is small, highly indexed, and global by nature.

### Household-Local Data

Move household-local canonical and reporting data into the Durable Object's SQLite store.

Examples:

- `accounts`
- `account_ownership` or ownership fields
- `account_visibility` or visibility fields
- `balance_snapshots`
- `holdings`
- `holding_snapshots`
- `transactions` if retained for cashflow computation
- `sync_runs`
- `sync_checkpoints`
- reporting facts and current-state read models

### Provider Secrets

This needs an explicit choice.

Option A: store provider secrets in the household object.

- strongest local isolation story
- simpler household sync execution path
- harder to query globally for admin/debugging

Option B: store provider secrets in the shared control plane and pass them into the object when needed.

- simpler control-plane management
- weaker isolation boundary than object-local secret storage

Recommended direction: keep provider secrets household-local unless operational constraints make that impractical.

## Migration Principles

1. Make identity explicit before moving storage.
2. Introduce an abstraction boundary before introducing the Durable Object.
3. Prefer dual-write and parity-check stages over one-way cutovers.
4. Flip reads before deleting the legacy write path.
5. Keep rollback simple by preserving the legacy path until confidence is high.
6. Avoid using the Durable Object as a raw SQL tunnel.

## Migration Phases

### Phase 0: Baseline and Naming

Objective:
establish naming, boundaries, and rollout constraints before code churn.

Deliverables:

- this migration plan
- a naming convention for the state worker and `HouseholdState` Durable Object
- a decision on control-plane schema shape
- a decision on where provider secrets live
- success metrics for parity and rollback

Exit criteria:

- agreed architecture vocabulary
- agreed target runtime split

### Phase 1: Make Household Identity Explicit

Progress:
completed on 2026-04-11 for the current D1 architecture.

Implemented details:

- query/helper call sites now pass explicit household ids instead of relying on implicit first-household resolution
- request entrypoints resolve household identity once and thread it through downstream reads and writes
- Plaid onboarding now creates a generated household id when bootstrapping the first household and rejects ambiguous multi-household flows unless a household id is supplied

Objective:
remove implicit single-household behavior from the current codebase.

Required changes:

- stop defaulting to the first household in query helpers
- stop creating or assuming a constant default household id in onboarding flows
- require an explicitly resolved household id in loaders, actions, and sync entrypoints
- add a household resolution layer based on authenticated context or request routing

Likely touchpoints in the current repo:

- `apps/web/app/lib/plaid-connect.ts`
- `packages/db/src/queries.ts`
- `packages/db/src/portfolio.ts`
- `packages/db/src/account-curation.ts`
- `apps/web/app/routes/home.tsx`
- `apps/web/app/routes/portfolio.tsx`
- `apps/web/app/routes/account-review.tsx`
- `apps/sync/src/index.ts`

Why this phase matters:

If household identity is still implicit, moving storage into Durable Objects just relocates ambiguity instead of removing it.

Exit criteria:

- no product path relies on "first household wins"
- every household-scoped request resolves a household id explicitly

### Phase 2: Insert a Household Storage Boundary

Progress:
completed on 2026-04-11 for the D1-backed implementation.

Implemented details:

- added a D1-backed `HouseholdService` abstraction
- updated home, portfolio, account review, connect Plaid, and sync-worker snapshot reads to depend on the service boundary at the entrypoint layer
- kept the underlying storage implementation in D1 so behavior remains stable while preparing for the later Durable Object swap

Objective:
decouple product and sync logic from direct D1 usage.

Required changes:

- define a `HouseholdStore` or `HouseholdService` interface
- adapt home snapshot, portfolio snapshot, account curation, and sync workflows to use that interface
- keep a D1-backed implementation initially
- remove direct `D1Database` assumptions from outer application layers where practical

This boundary should expose domain-level methods such as:

- `getHomepageSnapshot(householdId)`
- `getPortfolioSnapshot(householdId)`
- `getAccountCurationSnapshot(householdId)`
- `updateAccountCuration(householdId, input)`
- `syncPlaidConnection(householdId, connectionId)`

It should not expose generic methods such as:

- `executeSql(query)`
- `runRawStatement(statement)`

Why this phase matters:

Without this step, the migration becomes a large search-and-replace across route code, sync code, and tests.

Exit criteria:

- web and sync entrypoints depend on a household-oriented boundary rather than raw D1 directly
- a D1-backed implementation still passes existing behavior checks

### Phase 3: Introduce the State Worker and Household Durable Object

Objective:
add the new isolation runtime without cutting over production reads or writes yet.

Required changes:

- create `apps/state`
- define the `HouseholdState` Durable Object
- define object methods for the core read and write flows
- add service bindings so web and sync can call the state worker
- add a control-plane lookup that resolves household id to object id
- build the initial household-local SQLite schema inside the object

Recommended Durable Object responsibilities:

- initialize household schema lazily or on explicit provision
- serialize sync and curation writes per household
- expose snapshot reads for home and portfolio
- expose account curation writes and reads
- own the household-local sync log and checkpoint state

Recommended non-responsibilities:

- global membership lookups
- generic auth resolution
- acting as a raw SQL endpoint

Exit criteria:

- local dev can provision and call a `HouseholdState` object
- the object can serve at least one real read path and one real write path in isolation tests

### Phase 4: Dual-Write Household Data

Objective:
populate the new household-local store while keeping the shared D1 path intact.

Required changes:

- sync writes to legacy D1 and household state
- account curation writes to legacy D1 and household state
- onboarding creates required control-plane records and household object state
- add parity verification tools between legacy D1 and object-local data

Suggested parity checks:

- account count by household
- total cash, investments, and net worth
- latest successful sync timestamps
- holdings count and market value totals
- account curation fields such as ownership, hidden, and reporting inclusion

Why this phase matters:

This is the safest way to establish confidence before user-facing reads move over.

Exit criteria:

- parity checks pass consistently for representative households
- dual-write failures are visible and actionable

### Phase 5: Cut Over Reads

Objective:
serve product reads from household state while retaining legacy writes as a fallback.

Read paths to move first:

- home snapshot
- portfolio snapshot
- account review snapshot

Recommended rollout:

- behind a feature flag or environment gate
- first in local dev
- then in preview environments
- then for a limited set of internal households

Required safeguards:

- compare object-sourced snapshot totals to legacy D1 during rollout
- log deltas above a strict threshold
- preserve an emergency switch to route reads back to D1

Exit criteria:

- object-backed reads are stable and correct under normal sync and curation activity
- rollback to D1 reads remains possible

### Phase 6: Cut Over Writes and Retire Legacy Canonical D1

Objective:
make household state the sole source of truth for household-local finance data.

Required changes:

- stop writing household-local canonical data to shared D1
- keep only control-plane records in shared D1
- archive or remove legacy canonical-table dependencies
- simplify query helpers that only existed for the shared D1 model

Recommended final state for shared D1:

- household registry
- household membership and auth resolution
- provider connection routing metadata
- global admin metadata that is not household-local finance state

Exit criteria:

- no user-facing or sync path depends on shared D1 household-local tables
- rollback plan is documented, even if it requires an explicit backfill

## Rollback Strategy

Rollback must stay easy until Phase 6 is complete.

Recommended rollback model:

- before read cutover: continue serving all reads from legacy D1
- during read cutover: retain a flag that routes reads back to D1
- during dual-write: continue validating state parity so D1 remains trustworthy
- after write cutover: keep export or backfill tooling available until the team is confident enough to remove it

The migration should not rely on a "big bang" irreversible cutover.

## Control-Plane Design Notes

The control plane should answer these questions quickly and deterministically:

- which households can this authenticated user access?
- which household owns this provider connection id?
- which Durable Object instance owns this household?
- what worker or task should be invoked to sync this household?

Likely tables or logical entities:

- `households`
- `household_memberships`
- `provider_connections_registry`
- `household_object_registry` if object id persistence is needed explicitly

The control plane should stay small and boring.

## Durable Object API Shape

The state worker should expose narrow, household-oriented methods.

Suggested operations:

- `getHomepageSnapshot`
- `getPortfolioSnapshot`
- `getAccountCurationSnapshot`
- `updateAccountCuration`
- `createProviderConnection`
- `syncProviderConnection`
- `ingestFixtureData`
- `exportHouseholdState` for debug or migration tooling

Suggested internal design:

- request validation at the object boundary
- explicit transaction boundaries for sync operations
- idempotent sync commands keyed by run id or provider connection state
- typed input and output payloads rather than ad hoc fetch payloads

## Testing Strategy

The migration should clean up test seams early.

Current pain points:

- many tests are wired directly to fake D1 implementations
- multiple packages duplicate test-only D1 wrappers
- storage assumptions leak into route and sync tests

Recommended testing strategy by phase:

### Before the Durable Object Exists

- add tests around explicit household id resolution
- add tests for the new household service boundary using the D1-backed implementation

### When the Durable Object Is Introduced

- add object-level tests for household-local reads and writes
- add sync serialization tests to verify concurrent writes are ordered safely
- add parity tests comparing D1-backed and Durable Object-backed implementations on the same fixtures

### Before Read Cutover

- add end-to-end tests that exercise web and sync against the state worker in local dev
- add snapshot and portfolio parity tests against seeded data

### After Write Cutover

- remove duplicated legacy-only storage tests gradually, not all at once

## Local Development Impact

The current dev workflow shares D1 state between web and sync workers.

The target workflow will need:

- a third runtime for the state worker
- service bindings from web and sync to state
- a way to persist Durable Object state locally between runs
- optional bootstrap logic to create household objects and seed or migrate local state

Developer ergonomics goals:

- `bun run dev` should still start the full stack
- local reset should clear both control-plane D1 state and Durable Object state
- fixture or seed flows should work without manual object surgery

## Observability and Operations

The migration should improve visibility into household-specific failures.

Recommended logging and metrics:

- household id on every sync and curation write log
- connection id on provider sync logs
- parity mismatch counters during dual-write and read cutover
- object method latency and error counts
- explicit log events for fallback to legacy reads

Recommended operational tools:

- export household state for debugging
- replay a household sync against a test object
- compare household totals between control plane and state plane

## Security Considerations

This migration is justified mainly by isolation, so the isolation story must remain strong in implementation.

Key requirements:

- no route or sync path should infer household id from ambiguous defaults
- web requests must resolve household access through authenticated membership checks
- service-to-service calls must pass explicit household ids and validate them
- provider secrets should not be broadly readable from shared paths if they can be stored household-locally
- debug or export operations must be gated carefully

## First PR Scope

The first implementation PR should stay narrow.

Recommended scope:

1. remove implicit single-household behavior
2. add the household storage boundary

This is the right first step because it delivers architectural leverage before introducing a new runtime.

Likely files affected first:

- `apps/web/app/lib/plaid-connect.ts`
- `packages/db/src/queries.ts`
- `packages/db/src/portfolio.ts`
- `packages/db/src/account-curation.ts`
- `apps/web/app/routes/home.tsx`
- `apps/web/app/routes/portfolio.tsx`
- `apps/web/app/routes/account-review.tsx`
- `apps/sync/src/index.ts`

## Open Questions

1. Should provider secrets live inside the household object or in the shared control plane?
2. Should sync execution happen inside the household object or should the sync worker fetch provider data and submit normalized writes into the object?
3. Should household object ids be deterministic from household id, or persisted via a registry table?
4. How much of the reporting layer should remain materialized versus recomputed on demand inside the object?
5. Do transactions remain part of v1 household-local storage, or can they stay deferred until the architecture settles?

## Recommended Immediate Next Steps

1. Implement Phase 1 and Phase 2 together in a first PR.
2. Decide the provider-secret storage policy before adding the state worker.
3. Draft the control-plane schema and the `HouseholdState` method surface before building `apps/state`.