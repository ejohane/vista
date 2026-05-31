# CLI JSON Output

Vista read commands support `--json` for agent and tool consumption. Default text output remains unchanged.

Supported commands:

```sh
vista dashboard --json
vista accounts --json
vista holdings --json
vista transactions --json --limit 25
vista income show --json
vista income show --json --person "Name"
```

## Contract

- Output is valid JSON written to stdout with no decorative text.
- Errors use the existing top-level CLI handler and are written to stderr.
- Every payload includes `schemaVersion: 1`.
- Monetary values use integer minor units in fields ending with `Minor`.
- Dates use `YYYY-MM-DD` strings.
- Timestamps use ISO 8601 UTC strings, or `null` when no timestamp is known.
- Source row currencies are exposed as `currency`; aggregate totals currently report `USD`.

## Shapes

`vista dashboard --json`

```ts
{
  schemaVersion: 1;
  summary: null | {
    netWorthMinor: number;
    cashMinor: number;
    investmentsMinor: number;
    liabilitiesMinor: number;
    currency: "USD";
    accountCount: number;
    holdingCount: number;
    bankTransactionCount: number;
    investmentTransactionCount: number;
    connectionCount: number;
    lastCompletedSyncAt: string | null;
    lastFailedSyncAt: string | null;
  };
  connections: Array<{
    institutionName: string;
    status: string;
    lastCompletedSyncAt: string | null;
  }>;
}
```

`vista accounts --json`

```ts
{
  schemaVersion: 1;
  totals: {
    netWorthMinor: number;
    cashMinor: number;
    investmentsMinor: number;
    liabilitiesMinor: number;
    currency: "USD";
  };
  accounts: Array<{
    id: string;
    name: string;
    displayName: string | null;
    institutionName: string;
    accountType: string;
    accountSubtype: string | null;
    reportingGroup: "cash" | "investments" | "liabilities";
    balanceMinor: number;
    currency: string;
    includeInHouseholdReporting: boolean;
    isHidden: boolean;
    updatedAt: string;
  }>;
}
```

`vista holdings --json`

```ts
{
  schemaVersion: 1;
  totals: {
    marketValueMinor: number;
    costBasisMinor: number;
    currency: "USD";
  };
  holdings: Array<{
    accountName: string;
    symbol: string | null;
    name: string;
    assetClass: string;
    quantity: string;
    priceMinor: number | null;
    marketValueMinor: number;
    costBasisMinor: number | null;
    currency: string;
  }>;
}
```

`vista transactions --json`

```ts
{
  schemaVersion: 1;
  limit: number;
  count: number;
  transactions: Array<{
    kind: "bank" | "investment";
    postedDate: string;
    accountName: string;
    type: string;
    subtype: string | null;
    symbol: string | null;
    quantity: string | null;
    amountMinor: number;
    currency: string;
    description: string;
  }>;
}
```

`vista income show --json`

```ts
{
  schemaVersion: 1;
  totals: {
    salaryMinor: number;
    bonusMinor: number;
    annualMinor: number;
    monthlyGrossMinor: number;
    currency: "USD";
  };
  profiles: Array<{
    id: string;
    personName: string;
    source: string;
    salaryMinor: number;
    bonusMinor: number;
    annualMinor: number;
    monthlyGrossMinor: number;
    currency: string;
    effectiveDate: string;
    note: string | null;
    updatedAt: string;
  }>;
}
```
