# PRD 0001: Vista v1 Household Financial Snapshot

- Status: Draft
- Date: 2026-03-15
- Related:
  - `docs/adr/0001-data-ingestion-strategy.md`
  - `docs/adr/0002-normalized-data-model-and-sync-workflow.md`

## Summary

Vista v1 is a household finance product for couples managing finances together. The primary experience is a fast, trustworthy snapshot of current financial state:

- total net worth
- total cash
- total investments

The product should answer those questions in under 30 seconds, then help explain what changed if a number looks off.

Vista v1 is not a budgeting product, not a real-time monitoring tool, and not a ledger-style transaction browser.

## Product Thesis

A couple should be able to open Vista and immediately understand where they stand financially right now, with minimal maintenance and enough supporting detail to see where the money is and what changed.

## Target User

Primary initial user:

- the creator household

Scale target:

- couples managing finances together
- couples may have partially separate finances rather than fully merged finances
- household visibility should default to shared, with the option to make accounts private

## Problem Statement

Existing consumer finance tools often optimize for budgeting, transaction browsing, or generic account aggregation. Vista's core user need is narrower and more practical:

- see total household net worth now
- see total household cash now
- see total household investments now
- understand where those amounts are held
- understand recent change without digging through a ledger

The product must deliver that value without requiring ongoing manual cleanup.

## Goals

1. Show trustworthy current total net worth.
2. Show trustworthy current total cash.
3. Show trustworthy current total investments.
4. Show enough supporting detail to explain what changed and where money is held.
5. Organize the default view around household state, not institution administration.
6. Keep recurring maintenance low after initial setup.
7. Provide light monthly spending and savings context without making categorization a core dependency.

## Non-Goals

- real-time balances as a core promise
- manual refresh as a required workflow
- detailed transaction register or ledger browsing
- budgeting workflows
- heavy transaction category management
- manual asset and liability tracking in v1
- broad generic support for every household structure in v1

## Core Experience

Primary usage loop:

1. Open Vista.
2. See current total net worth, total cash, and total investments.
3. If something looks off, see what changed and where the change occurred.

Secondary usage loop:

- check light monthly income, spending, savings, and savings rate trends

## Product Principles

### 1. Snapshot first

Current financial state is the product core. Trends and cashflow analytics support the snapshot rather than replacing it.

### 2. Household first

The default experience should answer household-level questions first. Ownership splits and privacy settings matter, but they should not clutter the first screen.

### 3. Trust over novelty

Net worth, cash, and investments must feel exact enough to trust. If those totals are wrong, the product fails.

### 4. Low-maintenance by default

Users may tolerate occasional account renaming, hiding, exclusion, or ownership fixes. The product should not depend on repeated categorization or reconciliation work.

### 5. Derived analytics are secondary

Monthly spending and savings are useful, but the primary value proposition must survive even if transaction categorization is only moderate quality.

## V1 User Experience Requirements

### Home Screen

The first screen should use a mixed layout: summary metrics first, breakdown second.

Required top-level content order:

1. total net worth
2. total cash
3. total investments
4. compact change summary
5. account breakdown grouped by account type

Default supporting breakdown should be grouped by account type, not by institution.

Examples of account-type groupings:

- checking and savings
- cash equivalents
- brokerage
- retirement
- liabilities when applicable

Ownership splits should live one level deeper rather than appearing in the default home-screen summary.

### Change Summary

The app should provide a compact explanation of what changed when totals move materially.

Examples:

- cash moved because one or more account balances changed
- investments moved because market value changed
- net worth moved because of a mix of cash, investment, or liability changes

The comparison window should be meaningful for a periodic check-in. Exact default comparison logic is still open.

### Freshness and Trust

The product should aim for highly accurate daily state, not real-time state.

Requirements:

- daily background sync
- clear last-updated timestamp near the snapshot
- no manual refresh requirement for the core experience
- messaging should emphasize freshness and accuracy without implying real-time precision

## Functional Requirements

### FR1. Snapshot Totals

Vista must calculate and display:

- total household net worth
- total household cash
- total household investments

These values must be derived from automatically connected accounts only in v1.

### FR2. Net Worth Scope

Household net worth in v1 includes:

- automatically synced bank accounts
- automatically synced investment accounts
- automatically synced liabilities when supported by connected providers

Household net worth in v1 excludes:

- manually entered real estate values
- manually entered vehicles
- private company equity
- manually entered debts
- other hand-maintained assets and liabilities

HSA support is deferred until a later ingestion decision is made.

### FR3. Account Organization

Accounts shown on the product surface must be organized primarily by account type. Institution name may appear as supporting metadata, but institution grouping should not drive the default home-screen layout.

### FR4. What Changed

Vista must help users understand where change occurred after they see the top-level totals.

At minimum, the product should be able to surface:

- which account groups changed
- which individual accounts changed materially
- whether the movement is primarily cash-driven, investment-driven, or liability-driven

### FR5. Ownership

Vista must support app-defined ownership labels for household reporting.

V1 ownership expectations:

- ownership can be set per account
- ownership editing should be occasional, not part of routine use
- ownership is available in deeper views, not on the default home screen

### FR6. Visibility and Privacy

Vista must treat visibility and ownership as separate concepts.

V1 behavior:

- newly added accounts are visible to both partners by default
- the account owner can make an account private during onboarding or later
- privacy settings should not be conflated with whether an account is included in household reporting

### FR7. Inclusion and Exclusion

Vista must allow an account to be excluded from household reporting.

Supported reasons include:

- privacy
- irrelevant or temporary account
- duplicate connected data
- business account
- legacy or closed account

Visibility and inclusion must be modeled as separate controls.

### FR8. Lightweight Cashflow Trends

Vista must support a light monthly cashflow layer, but it is secondary to the snapshot experience.

Required v1 cashflow outputs:

- monthly income
- monthly spending
- monthly savings
- savings rate

Not required in v1:

- deep category drill-down
- heavy category correction workflows
- transaction-ledger browsing

### FR9. Low-Friction Account Management

V1 must support lightweight account curation:

- rename account display names
- hide irrelevant accounts
- set ownership
- exclude accounts from reporting

These actions should be rare maintenance tasks rather than recurring chores.

## Success Criteria

Vista v1 succeeds when:

- a user can understand household net worth, cash, and investments in under 30 seconds
- those three snapshot totals are trusted enough to act as the household source of truth
- the home screen makes it easy to see where money is held without switching views
- recurring maintenance remains low after initial setup
- monthly income, spending, and savings provide useful context without becoming the center of the product

## Dependencies and Constraints

This PRD assumes the currently accepted architecture decisions:

- hybrid ingestion using SimpleFIN Bridge for banking and SnapTrade for investments
- normalized internal data model
- poll-first sync workflow
- daily sync by default
- provider data is not the product model

The product should not depend on real-time sync, manual refresh, or perfect transaction categorization to deliver the primary value proposition.

## Scale Guardrails

Although v1 is initially for one household, the product should avoid locking itself into family-specific assumptions that will block future growth.

Guardrails:

- do not hard-code spouse-specific roles into the long-term product model
- keep member identity, account ownership, visibility, and reporting inclusion separate
- design deeper views so couple-level collaboration works even when finances are only partially shared
- treat the current `mine / wife / joint` framing as a reporting convenience, not the only durable abstraction

## Open Questions

1. What should the default comparison window be for the change summary?
2. How should private accounts behave in household totals versus member-only views once privacy controls ship?
3. When HSA support is added, should it be presented inside cash, investments, or a distinct account-type grouping?
