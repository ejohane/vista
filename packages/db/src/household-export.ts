import type {
  AccountType,
  HoldingAssetClass,
  NetWorthCoverageMode,
  OwnershipType,
  ProviderConnectionStatus,
  ProviderType,
  ReportingGroup,
  SyncRunStatus,
  SyncRunTrigger,
} from "./schema";

export type ExportedHouseholdRow = {
  createdAt: Date;
  id: string;
  lastSyncedAt: Date;
  name: string;
};

export type ExportedProviderConnectionRow = {
  accessSecret: null | string;
  accessToken: null | string;
  accessUrl: null | string;
  createdAt: Date;
  externalConnectionId: string;
  householdId: string;
  id: string;
  institutionId: null | string;
  institutionName: null | string;
  plaidItemId: null | string;
  provider: ProviderType;
  status: ProviderConnectionStatus;
  updatedAt: Date;
};

export type ExportedProviderAccountRow = {
  accountSubtype: null | string;
  accountType: AccountType;
  createdAt: Date;
  currency: string;
  id: string;
  institutionName: string;
  name: string;
  providerAccountId: string;
  providerConnectionId: string;
  updatedAt: Date;
};

export type ExportedAccountRow = {
  accountSubtype: null | string;
  accountType: AccountType;
  balanceMinor: number;
  createdAt: Date;
  currency: string;
  displayName: null | string;
  householdId: string;
  id: string;
  includeInHouseholdReporting: boolean;
  institutionName: string;
  isHidden: boolean;
  name: string;
  ownershipType: OwnershipType;
  providerAccountId: null | string;
  reportingGroup: ReportingGroup;
  updatedAt: Date;
};

export type ExportedSyncRunRow = {
  completedAt: Date | null;
  errorSummary: null | string;
  householdId: string;
  id: string;
  provider: null | ProviderType;
  providerConnectionId: null | string;
  recordsChanged: number;
  startedAt: Date;
  status: SyncRunStatus;
  trigger: SyncRunTrigger;
};

export type ExportedBalanceSnapshotRow = {
  accountId: string;
  asOfDate: string;
  balanceMinor: number;
  capturedAt: Date;
  id: string;
  sourceSyncRunId: string;
};

export type ExportedHoldingRow = {
  accountId: string;
  assetClass: HoldingAssetClass;
  createdAt: Date;
  currency: string;
  holdingKey: string;
  id: string;
  name: string;
  securityId: null | string;
  subAssetClass: null | string;
  symbol: null | string;
  updatedAt: Date;
};

export type ExportedHoldingSnapshotRow = {
  accountId: string;
  asOfDate: string;
  capturedAt: Date;
  costBasisMinor: null | number;
  holdingId: string;
  id: string;
  marketValueMinor: number;
  priceMinor: null | number;
  quantity: string;
  sourceSyncRunId: string;
};

export type ExportedDailyNetWorthFactRow = {
  cashMinor: number;
  coverageMode: NetWorthCoverageMode;
  factDate: string;
  householdId: string;
  investmentsMinor: number;
  isEstimated: boolean;
  liabilitiesMinor: number;
  netWorthMinor: number;
  rebuiltAt: Date;
};

export type HouseholdStateExport = {
  accounts: ExportedAccountRow[];
  balanceSnapshots: ExportedBalanceSnapshotRow[];
  dailyNetWorthFacts: ExportedDailyNetWorthFactRow[];
  holdings: ExportedHoldingRow[];
  household: ExportedHouseholdRow;
  holdingSnapshots: ExportedHoldingSnapshotRow[];
  providerAccounts: ExportedProviderAccountRow[];
  providerConnections: ExportedProviderConnectionRow[];
  syncRuns: ExportedSyncRunRow[];
};

function toBoolean(value: boolean | number) {
  return Boolean(value);
}

function toDate(value: null | number | string | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);

    return Number.isNaN(parsed) ? null : new Date(parsed);
  }

  return new Date(value);
}

export async function exportHouseholdState(
  database: D1Database,
  householdId: string,
): Promise<HouseholdStateExport | null> {
  const household = await database
    .prepare(
      `
        select
          created_at as createdAt,
          id,
          last_synced_at as lastSyncedAt,
          name
        from households
        where id = ?
      `,
    )
    .bind(householdId)
    .first<{
      createdAt: number;
      id: string;
      lastSyncedAt: number;
      name: string;
    }>();

  if (!household) {
    return null;
  }

  const providerConnections = await database
    .prepare(
      `
        select
          access_secret as accessSecret,
          access_token as accessToken,
          access_url as accessUrl,
          created_at as createdAt,
          external_connection_id as externalConnectionId,
          household_id as householdId,
          id,
          institution_id as institutionId,
          institution_name as institutionName,
          plaid_item_id as plaidItemId,
          provider,
          status,
          updated_at as updatedAt
        from provider_connections
        where household_id = ?
        order by created_at asc, id asc
      `,
    )
    .bind(householdId)
    .all<{
      accessSecret: null | string;
      accessToken: null | string;
      accessUrl: null | string;
      createdAt: number;
      externalConnectionId: string;
      householdId: string;
      id: string;
      institutionId: null | string;
      institutionName: null | string;
      plaidItemId: null | string;
      provider: ProviderType;
      status: ProviderConnectionStatus;
      updatedAt: number;
    }>();

  const providerAccounts = await database
    .prepare(
      `
        select
          provider_accounts.account_subtype as accountSubtype,
          provider_accounts.account_type as accountType,
          provider_accounts.created_at as createdAt,
          provider_accounts.currency,
          provider_accounts.id,
          provider_accounts.institution_name as institutionName,
          provider_accounts.name,
          provider_accounts.provider_account_id as providerAccountId,
          provider_accounts.provider_connection_id as providerConnectionId,
          provider_accounts.updated_at as updatedAt
        from provider_accounts
        inner join provider_connections
          on provider_connections.id = provider_accounts.provider_connection_id
        where provider_connections.household_id = ?
        order by provider_accounts.created_at asc, provider_accounts.id asc
      `,
    )
    .bind(householdId)
    .all<{
      accountSubtype: null | string;
      accountType: AccountType;
      createdAt: number;
      currency: string;
      id: string;
      institutionName: string;
      name: string;
      providerAccountId: string;
      providerConnectionId: string;
      updatedAt: number;
    }>();

  const accounts = await database
    .prepare(
      `
        select
          account_subtype as accountSubtype,
          account_type as accountType,
          balance_minor as balanceMinor,
          created_at as createdAt,
          currency,
          display_name as displayName,
          household_id as householdId,
          id,
          include_in_household_reporting as includeInHouseholdReporting,
          institution_name as institutionName,
          is_hidden as isHidden,
          name,
          ownership_type as ownershipType,
          provider_account_id as providerAccountId,
          reporting_group as reportingGroup,
          updated_at as updatedAt
        from accounts
        where household_id = ?
        order by created_at asc, id asc
      `,
    )
    .bind(householdId)
    .all<{
      accountSubtype: null | string;
      accountType: AccountType;
      balanceMinor: number;
      createdAt: number;
      currency: string;
      displayName: null | string;
      householdId: string;
      id: string;
      includeInHouseholdReporting: boolean | number;
      institutionName: string;
      isHidden: boolean | number;
      name: string;
      ownershipType: OwnershipType;
      providerAccountId: null | string;
      reportingGroup: ReportingGroup;
      updatedAt: number;
    }>();

  const syncRuns = await database
    .prepare(
      `
        select
          completed_at as completedAt,
          error_summary as errorSummary,
          household_id as householdId,
          id,
          provider,
          provider_connection_id as providerConnectionId,
          records_changed as recordsChanged,
          started_at as startedAt,
          status,
          trigger
        from sync_runs
        where household_id = ?
        order by started_at asc, id asc
      `,
    )
    .bind(householdId)
    .all<{
      completedAt: null | number;
      errorSummary: null | string;
      householdId: string;
      id: string;
      provider: null | ProviderType;
      providerConnectionId: null | string;
      recordsChanged: number;
      startedAt: number;
      status: SyncRunStatus;
      trigger: SyncRunTrigger;
    }>();

  const balanceSnapshots = await database
    .prepare(
      `
        select
          balance_snapshots.account_id as accountId,
          balance_snapshots.as_of_date as asOfDate,
          balance_snapshots.balance_minor as balanceMinor,
          balance_snapshots.captured_at as capturedAt,
          balance_snapshots.id,
          balance_snapshots.source_sync_run_id as sourceSyncRunId
        from balance_snapshots
        inner join accounts on accounts.id = balance_snapshots.account_id
        where accounts.household_id = ?
        order by balance_snapshots.captured_at asc, balance_snapshots.id asc
      `,
    )
    .bind(householdId)
    .all<{
      accountId: string;
      asOfDate: string;
      balanceMinor: number;
      capturedAt: number;
      id: string;
      sourceSyncRunId: string;
    }>();

  const holdings = await database
    .prepare(
      `
        select
          holdings.account_id as accountId,
          holdings.asset_class as assetClass,
          holdings.created_at as createdAt,
          holdings.currency,
          holdings.holding_key as holdingKey,
          holdings.id,
          holdings.name,
          holdings.security_id as securityId,
          holdings.sub_asset_class as subAssetClass,
          holdings.symbol,
          holdings.updated_at as updatedAt
        from holdings
        inner join accounts on accounts.id = holdings.account_id
        where accounts.household_id = ?
        order by holdings.created_at asc, holdings.id asc
      `,
    )
    .bind(householdId)
    .all<{
      accountId: string;
      assetClass: HoldingAssetClass;
      createdAt: number;
      currency: string;
      holdingKey: string;
      id: string;
      name: string;
      securityId: null | string;
      subAssetClass: null | string;
      symbol: null | string;
      updatedAt: number;
    }>();

  const holdingSnapshots = await database
    .prepare(
      `
        select
          holding_snapshots.account_id as accountId,
          holding_snapshots.as_of_date as asOfDate,
          holding_snapshots.captured_at as capturedAt,
          holding_snapshots.cost_basis_minor as costBasisMinor,
          holding_snapshots.holding_id as holdingId,
          holding_snapshots.id,
          holding_snapshots.market_value_minor as marketValueMinor,
          holding_snapshots.price_minor as priceMinor,
          holding_snapshots.quantity,
          holding_snapshots.source_sync_run_id as sourceSyncRunId
        from holding_snapshots
        inner join accounts on accounts.id = holding_snapshots.account_id
        where accounts.household_id = ?
        order by holding_snapshots.captured_at asc, holding_snapshots.id asc
      `,
    )
    .bind(householdId)
    .all<{
      accountId: string;
      asOfDate: string;
      capturedAt: number;
      costBasisMinor: null | number;
      holdingId: string;
      id: string;
      marketValueMinor: number;
      priceMinor: null | number;
      quantity: string;
      sourceSyncRunId: string;
    }>();

  const dailyNetWorthFacts = await database
    .prepare(
      `
        select
          cash_minor as cashMinor,
          coverage_mode as coverageMode,
          fact_date as factDate,
          household_id as householdId,
          investments_minor as investmentsMinor,
          is_estimated as isEstimated,
          liabilities_minor as liabilitiesMinor,
          net_worth_minor as netWorthMinor,
          rebuilt_at as rebuiltAt
        from daily_net_worth_facts
        where household_id = ?
        order by fact_date asc
      `,
    )
    .bind(householdId)
    .all<{
      cashMinor: number;
      coverageMode: NetWorthCoverageMode;
      factDate: string;
      householdId: string;
      investmentsMinor: number;
      isEstimated: boolean | number;
      liabilitiesMinor: number;
      netWorthMinor: number;
      rebuiltAt: number;
    }>();

  return {
    accounts: accounts.results.map((row) => ({
      ...row,
      createdAt: toDate(row.createdAt) ?? new Date(0),
      includeInHouseholdReporting: toBoolean(row.includeInHouseholdReporting),
      isHidden: toBoolean(row.isHidden),
      updatedAt: toDate(row.updatedAt) ?? new Date(0),
    })),
    balanceSnapshots: balanceSnapshots.results.map((row) => ({
      ...row,
      capturedAt: toDate(row.capturedAt) ?? new Date(0),
    })),
    dailyNetWorthFacts: dailyNetWorthFacts.results.map((row) => ({
      ...row,
      isEstimated: toBoolean(row.isEstimated),
      rebuiltAt: toDate(row.rebuiltAt) ?? new Date(0),
    })),
    holdings: holdings.results.map((row) => ({
      ...row,
      createdAt: toDate(row.createdAt) ?? new Date(0),
      updatedAt: toDate(row.updatedAt) ?? new Date(0),
    })),
    household: {
      createdAt: toDate(household.createdAt) ?? new Date(0),
      id: household.id,
      lastSyncedAt: toDate(household.lastSyncedAt) ?? new Date(0),
      name: household.name,
    },
    holdingSnapshots: holdingSnapshots.results.map((row) => ({
      ...row,
      capturedAt: toDate(row.capturedAt) ?? new Date(0),
    })),
    providerAccounts: providerAccounts.results.map((row) => ({
      ...row,
      createdAt: toDate(row.createdAt) ?? new Date(0),
      updatedAt: toDate(row.updatedAt) ?? new Date(0),
    })),
    providerConnections: providerConnections.results.map((row) => ({
      ...row,
      createdAt: toDate(row.createdAt) ?? new Date(0),
      updatedAt: toDate(row.updatedAt) ?? new Date(0),
    })),
    syncRuns: syncRuns.results.map((row) => ({
      ...row,
      completedAt: toDate(row.completedAt),
      startedAt: toDate(row.startedAt) ?? new Date(0),
    })),
  };
}
