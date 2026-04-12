# Plan 0001: Backfilled Net-Worth Series

- Status: Complete
- Date: 2026-04-11
- Related:
  - `docs/prd/0001-v1-household-financial-snapshot.md`
  - `docs/adr/0002-normalized-data-model-and-sync-workflow.md`
  - `packages/db/src/schema.ts`
  - `packages/db/src/queries.ts`
  - `packages/plaid/src/index.ts`

## Summary

Build a backfilled daily net-worth series for investment accounts by reconstructing historical positions from imported investment transactions and valuing those positions with daily security prices.

## Progress

| Milestone | Status | Notes |
| --- | --- | --- |
| 0. Design Lock | Complete | Alpha Vantage is the Phase 1 provider target. |
| 1. Schema for Securities and Price History | Complete | Schema, migration, and manual verification are in place. |
| 2. Security Upsert and Price Import Pipeline | Complete | Plaid sync now upserts securities and seeds holding prices. The bounded importer stores missing weekdays deterministically. |
| 3. Historical Position Reconstruction Engine | Complete | Reverse reconstruction from holdings plus investment transactions is in place and idempotently rebuilds bounded date windows. |
| 4. Daily Investment Value Facts | Complete | Daily investment-account value facts are materialized from reconstructed positions plus imported prices, including estimated-price signaling. |
| 5. Household Net-Worth Facts | Complete | Daily household facts are materialized with explicit `coverage_mode` for investment-only and mixed snapshot/backfill coverage. |
| 6. Homepage Read Path and UX | Complete | Homepage history now prefers derived net-worth facts and surfaces backfilled, estimated, and mixed-coverage messaging. |
| 7. Backfill Job and Recompute Workflow | Complete | The scheduled sync worker now imports Alpha Vantage prices when `ALPHA_VANTAGE_API_KEY` is configured and rebuilds only households touched by the current sync run. Manual worker smoke verification is complete. |

This is not a small extension of the current homepage chart. The current chart is sync-snapshot driven and only plots succeeded sync runs. This plan adds a derived reporting pipeline that can produce a daily historical series independent of sync cadence.

## Problem

The current homepage trend is driven by `balance_snapshots` captured at sync time. That means:

- one successful sync produces one chart point
- imported historical investment transactions do not automatically produce a trend
- the chart reflects sync frequency, not true historical portfolio movement

For investment accounts, we now have enough source data to attempt a real backfill:

- current holdings and current holding prices
- investment transactions with quantity, date, type, subtype, and often trade price
- stable security identifiers and ticker symbols

What is still missing is a daily security price history and a derived-facts pipeline.

## Goals

1. Produce a daily backfilled investment-value series for up to Plaid's available history window.
2. Use that daily investment series to power a real historical net-worth chart when the household only has investment accounts connected.
3. Preserve the existing snapshot-first architecture by treating the backfilled series as derived reporting facts, not as the primary source of truth.
4. Keep the implementation testable with red/green milestones and narrow acceptance criteria.

## Non-Goals

1. Rebuild a full consumer-grade transaction ledger UI.
2. Produce perfectly reconstructed daily history for every account type in the first pass.
3. Infer full historical cash balances for bank accounts from transaction history alone.
4. Guarantee exact pre-window history beyond Plaid's available investment-transaction range.

## Scope Recommendation

Phase 1 should target Plaid investment accounts only.

Reasoning:

- The imported Vanguard data already reconciles cleanly with current holdings.
- Investment transactions plus daily prices are sufficient to reconstruct position-driven history.
- Bank-account history is a different problem because transaction history alone does not imply daily balances without a reliable opening balance model.

The first release should therefore treat backfilled history as:

- authoritative for connected investment accounts within the available window
- unavailable or snapshot-only for unsupported account types

## Proposed Architecture

Add a reporting pipeline with four layers:

1. Security reference layer
2. Daily price history layer
3. Historical position reconstruction layer
4. Daily net-worth facts layer

### 1. Security Reference Layer

Add a canonical `securities` table keyed by an app-owned security id.

Suggested fields:

- `id`
- `provider`
- `provider_security_id`
- `symbol`
- `name`
- `security_type`
- `security_subtype`
- `currency`
- `price_source`
- `created_at`
- `updated_at`

Purpose:

- decouple app reporting from Plaid-only ids
- support external price-provider joins
- allow future cross-provider security normalization

### 2. Daily Price History Layer

Add a `security_price_daily` table.

Suggested fields:

- `security_id`
- `price_date`
- `close_price_minor`
- `currency`
- `source`
- `is_estimated`
- `fetched_at`

Recommended uniqueness:

- unique index on `(security_id, price_date)`

Purpose:

- provide deterministic valuation inputs per day
- support recomputation of historical portfolio facts
- make missing-price handling explicit

### 3. Historical Position Reconstruction Layer

Add a derived daily positions layer. This can either be persisted as its own fact table or computed into account-value facts directly.

Two acceptable shapes:

1. `daily_security_position_facts`
2. `daily_investment_account_value_facts`

I would start with `daily_security_position_facts` because it is easier to validate and rebuild.

Suggested fields:

- `household_id`
- `account_id`
- `security_id`
- `position_date`
- `quantity`
- `cost_basis_minor` nullable
- `source_window_start`
- `source_window_end`
- `is_estimated`
- `rebuilt_at`

Reconstruction model:

- anchor from the latest holding snapshot for each security in each account
- sort investment transactions descending by effective date
- walk backward and subtract transaction quantity effects to derive prior positions
- persist end-of-day quantity for each historical date in scope

### 4. Daily Net-Worth Facts Layer

Add `daily_net_worth_facts`.

Suggested fields:

- `household_id`
- `fact_date`
- `cash_minor`
- `investments_minor`
- `liabilities_minor`
- `net_worth_minor`
- `coverage_mode`
- `is_estimated`
- `rebuilt_at`

`coverage_mode` should explicitly describe how the row was produced, for example:

- `snapshot_only`
- `investments_backfilled`
- `mixed_snapshot_and_backfill`

Purpose:

- keep homepage reads simple
- preserve explainability of what kind of history the user is looking at
- allow future household-wide history without replacing the schema again

## Price-Provider Requirement

This project needs a historical daily price source for equities, ETFs, and mutual funds.

Provider requirements:

1. Reliable Vanguard fund and ETF coverage.
2. Daily close or NAV history for at least the Plaid transaction window.
3. Stable symbol or identifier lookup that can be mapped from Plaid securities.
4. Predictable pricing and terms for low-scale household usage.

This is the primary external dependency. Without it, the backfill cannot be trustworthy.

## Reconstruction Rules

The core engine should reconstruct positions using signed quantity deltas.

The implementation must normalize Plaid investment transaction types into quantity effects:

- `buy`: increase quantity
- `sell`: decrease quantity
- `reinvest dividend`: increase quantity
- `transfer in`: increase quantity when represented as position movement
- `transfer out`: decrease quantity when represented as position movement
- fees, dividends, and interest without security quantity change: do not change position quantity

Open design points:

1. Whether to model a separate historical cash sleeve for investment accounts.
2. How to classify ambiguous Plaid types and subtypes safely.
3. Whether to backfill only security-backed value first and defer historical cash.

Given current Vanguard data, Phase 1 can reasonably assume security-backed holdings explain the account balance, but that assumption should be verified per institution rather than baked in globally.

## Read-Path Strategy

Do not rewrite the homepage to query raw transactions.

Instead:

1. Add a new query path that reads `daily_net_worth_facts`.
2. Preserve the existing `balance_snapshots` logic as fallback.
3. Use fact coverage to decide which chart mode is available.

Recommended homepage behavior:

- prefer `daily_net_worth_facts` when there are at least 2 dated fact rows
- otherwise fall back to sync-snapshot history
- if neither exists, keep the current empty-chart message

## Red/Green Milestones

### Milestone 0: Design Lock

Outcome:

- choose a historical price provider
- lock Phase 1 to investment accounts only
- document price-provider mapping assumptions

Red tests:

- none; documentation milestone

Green acceptance:

- one explicit provider choice and mapping strategy
- approved fact-table shape

### Milestone 1: Schema for Securities and Price History

Outcome:

- add schema and migration for `securities`
- add schema and migration for `security_price_daily`

Red tests:

- schema tests proving uniqueness and required columns
- migration tests proving duplicate daily prices are rejected per security/date

Green acceptance:

- schema compiles
- migrations apply cleanly
- targeted schema tests pass

### Milestone 2: Security Upsert and Price Import Pipeline

Outcome:

- populate `securities` from Plaid holdings and investment transactions
- implement price-history importer for mapped securities

Red tests:

- Plaid sync test proves securities are upserted with stable ids and symbols
- importer test proves daily prices are stored idempotently
- importer test proves missing prices are marked and surfaced deterministically

Green acceptance:

- one sync creates or updates security-master rows
- one import run creates daily prices for a bounded date range

### Milestone 3: Historical Position Reconstruction Engine

Outcome:

- reconstruct daily positions per account/security from latest holdings plus transactions

Red tests:

- fixture with buys and sells reconstructs expected quantities on specific dates
- fixture with reinvested dividends increases quantity correctly
- fixture with non-position cash events leaves quantity unchanged
- fixture with missing price dates still yields position rows without valuation

Green acceptance:

- engine produces deterministic quantities for a bounded test window
- repeated runs are idempotent

### Milestone 4: Daily Investment Value Facts

Outcome:

- join reconstructed positions to `security_price_daily`
- materialize daily investment-account values

Red tests:

- known test portfolio produces expected daily market values across several dates
- stale or missing prices trigger the expected `is_estimated` behavior
- account totals equal the sum of daily security values

Green acceptance:

- facts are rebuildable from raw data
- fact totals reconcile with current holding snapshots on overlapping dates

### Milestone 5: Household Net-Worth Facts

Outcome:

- materialize `daily_net_worth_facts` from investment value facts plus whatever snapshot-backed components are available

Red tests:

- investment-only household gets a contiguous daily net-worth series
- mixed household clearly reports `coverage_mode`
- incomplete non-investment coverage does not silently masquerade as full household history

Green acceptance:

- query layer returns a daily historical series with clear provenance
- totals remain consistent with current snapshot reads for the latest date

### Milestone 6: Homepage Read Path and UX

Outcome:

- homepage chart prefers backfilled facts when present
- UI messaging distinguishes sync-history from backfilled-history

Red tests:

- homepage route test renders a chart when daily facts exist even with only one sync run
- homepage route test falls back to snapshot history when facts are absent
- homepage route test shows coverage messaging for estimated or partial history

Green acceptance:

- a newly linked Vanguard-only household can see a historical trend after first sync and fact build

### Milestone 7: Backfill Job and Recompute Workflow

Outcome:

- add a rebuild command or worker job to recompute historical facts for a household

Red tests:

- rebuild is idempotent for the same raw inputs
- targeted rebuild only affects the requested household and date range

Green acceptance:

- operators can regenerate facts after sync or price corrections

## Testing Strategy

Use red/green TDD at three levels:

1. Schema and migration tests in `packages/db`
2. Engine and normalization tests in the data/reporting layer
3. Route/rendering tests in `apps/web`

Test fixtures should cover:

- ETF buy and sell sequences
- mutual fund dividend reinvestment
- zero-quantity account closures
- missing price days
- stale price fallback
- mixed household coverage where only investment history is backfilled

The most important invariant tests are:

1. reconstructed latest-day value matches current holdings-derived value
2. repeated rebuilds are idempotent
3. partial coverage is labeled, not hidden

## Rollout Strategy

Recommended rollout:

1. Ship the fact pipeline behind a read-path flag.
2. Validate against the Vanguard household first.
3. Compare latest fact values against live snapshot totals daily.
4. Enable the homepage chart to prefer backfilled facts only after reconciliation is stable.

## Risks

1. Price-provider coverage for Vanguard mutual funds may be incomplete or delayed.
2. Plaid transaction subtype semantics may be inconsistent across institutions.
3. Historical investment cash may not be reconstructible with enough fidelity for every account.
4. Cross-provider security mapping may become a source of duplicate or split identities.

## Recommendation

Start with a narrow Phase 1 implementation:

1. Plaid investment accounts only.
2. Daily security prices from one chosen provider.
3. Reconstructed investment value facts.
4. Homepage chart powered by `daily_net_worth_facts` when available.

This delivers the user-visible outcome you want without forcing the product to solve the harder bank-balance reconstruction problem at the same time.