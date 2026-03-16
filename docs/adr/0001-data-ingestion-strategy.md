# ADR 0001: Initial Data Ingestion Strategy

- Status: Accepted
- Date: 2026-03-15

## Context

Vista is a household finance application focused on a high-level view of finances:

- Where all money is held
- Total net worth and account balances
- Portfolio composition
- Spending and savings trends over time

Vista is not intended to be a day-to-day transaction browser, but it still needs enough underlying financial data to compute household rollups and trends.

The primary constraint for v1 is minimizing ongoing data ingestion cost while still providing near-automatic syncing.

Known account mix for the initial household:

- 5-6 US Bank accounts
- 5 Vanguard accounts
- HSA account

The HSA decision is deferred for now and should not block the initial ingestion architecture.

## Decision

For v1, Vista will use a hybrid ingestion model:

- `SimpleFIN Bridge` for US Bank data
- `SnapTrade` for Vanguard investment data
- HSA is out of scope for this decision and may be manual or integrated later

Vista will represent external investment connectivity as a single connected user rather than separate household members in the provider layer.

Ownership will be modeled in Vista, not delegated to providers:

- `mine`
- `wife`
- `joint`

Provider data will be normalized into Vista's own schema and persisted internally. Vista remains the source of truth for ownership and household reporting.

## Rationale

### Why not Plaid-first

Plaid is broad, but its public billing model is subscription-oriented by Item for products such as Transactions and Liabilities. That makes it a poor default choice when cost minimization is the primary objective.

Lower sync frequency does not materially reduce Plaid subscription cost. The cost lever is the number of connected Items and subscribed products, not whether Vista refreshes once per day or more often.

### Why SimpleFIN for banking

SimpleFIN Bridge is low-cost and aligned with the desired sync model:

- flat pricing
- daily-update oriented
- balances and transactions available without a complex subscription matrix

This is a good fit for Vista's high-level financial overview, where daily freshness is acceptable.

### Why SnapTrade for investments

SnapTrade is a better fit for brokerage and retirement account aggregation than general bank aggregators.

For the current requirements, it provides the needed data shape:

- accounts
- balances
- holdings / positions
- portfolio composition inputs

Using a single connected user keeps the provider-side cost model simpler and cheaper than creating separate provider identities for each spouse.

### Why ownership lives in Vista

Provider ownership and identity signals are not reliable enough to be the sole classification mechanism for a household finance product.

Vista needs durable internal ownership labels for reporting:

- individual totals
- joint totals
- household rollups
- spouse-level portfolio and cash breakdowns

This also keeps the app portable across providers and avoids coupling reporting logic to any one vendor's account metadata.

## Estimated Monthly Ingestion Cost

Based on current public pricing and the current account mix:

- `SimpleFIN Bridge`: about `$1.25/month` effective when paid annually (`$15/year`), or `$1.50/month` when treated monthly
- `SnapTrade`: about `$2/month` for one connected user

Expected initial ingestion cost:

- about `$3.25/month` effective with annual SimpleFIN pricing
- about `$3.50/month` if treating SimpleFIN as monthly

This estimate assumes:

- US Bank accounts are accessible through one bank login / institution connection
- Vanguard accounts are accessible through one brokerage connection under one connected user
- HSA is excluded from the current cost estimate

## Consequences

### Positive

- Very low recurring ingestion cost
- Daily-refresh banking data is sufficient for Vista's product goals
- Investment data is handled by a provider specialized in brokerage connectivity
- Ownership logic remains fully controlled by the app

### Negative

- The architecture is hybrid, so normalization logic must support more than one provider
- HSA handling remains unresolved
- Some institutions may still require a later fallback connector if coverage gaps appear

## Rejected Alternatives

### Plaid-first for all data

Rejected because the public billing model suggests a higher and less transparent ongoing cost profile than necessary for this use case.

### Teller plus SnapTrade

Rejected as the default because Teller's transaction pricing is attractive, but balance pricing is a poor fit for an app centered on "where is my money right now" unless balance freshness is heavily degraded or manually refreshed.

## Implementation Notes

Initial ingestion design should assume:

- provider-specific connectors write into normalized internal account and snapshot tables
- provider identities are not exposed directly in reporting logic
- app-side ownership is editable and stored per account
- sync cadence is daily by default, with no paid real-time refresh features enabled

## Review Trigger

Revisit this decision if any of the following become true:

- HSA support becomes a core requirement
- current providers do not support the actual institutions reliably
- the product requires near-real-time balances instead of daily freshness
- a broader multi-household rollout changes the economics of provider billing

## References

- [SimpleFIN Bridge](https://beta-bridge.simplefin.org/)
- [SimpleFIN developer guide](https://beta-bridge.simplefin.org/info/developers)
- [SnapTrade pricing](https://snaptrade.com/pricing)
- [SnapTrade account data](https://docs.snaptrade.com/docs/account-data)
- [Plaid billing](https://plaid.com/docs/account/billing/)
- [Teller pricing](https://teller.io/)
