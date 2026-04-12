import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const syncRunStatuses = ["running", "succeeded", "failed"] as const;
export type SyncRunStatus = (typeof syncRunStatuses)[number];

export const syncRunTriggers = ["seed", "scheduled"] as const;
export type SyncRunTrigger = (typeof syncRunTriggers)[number];

export const providerTypes = ["plaid"] as const;
export type ProviderType = (typeof providerTypes)[number];

export const securityPriceSources = [
  "alpha_vantage",
  "plaid_holdings",
  "missing",
] as const;
export type SecurityPriceSource = (typeof securityPriceSources)[number];

export const netWorthCoverageModes = [
  "snapshot_only",
  "investments_backfilled",
  "mixed_snapshot_and_backfill",
] as const;
export type NetWorthCoverageMode = (typeof netWorthCoverageModes)[number];

export const providerConnectionStatuses = [
  "active",
  "disconnected",
  "error",
] as const;
export type ProviderConnectionStatus =
  (typeof providerConnectionStatuses)[number];

export const ownershipTypes = ["mine", "wife", "joint"] as const;
export type OwnershipType = (typeof ownershipTypes)[number];

export const accountTypes = [
  "checking",
  "savings",
  "credit_card",
  "brokerage",
  "retirement",
  "mortgage",
  "student_loan",
  "loan",
  "line_of_credit",
] as const;
export type AccountType = (typeof accountTypes)[number];

export const reportingGroups = ["cash", "liabilities", "investments"] as const;
export type ReportingGroup = (typeof reportingGroups)[number];

export const holdingAssetClasses = [
  "cash",
  "equity",
  "fixed_income",
  "crypto",
  "fund",
  "other",
] as const;
export type HoldingAssetClass = (typeof holdingAssetClasses)[number];

export const memberRoles = ["owner", "member"] as const;
export type MemberRole = (typeof memberRoles)[number];

export const authIdentityProviders = ["clerk"] as const;
export type AuthIdentityProvider = (typeof authIdentityProviders)[number];
export const transactionDirections = ["credit", "debit"] as const;
export type TransactionDirection = (typeof transactionDirections)[number];

export const households = sqliteTable("households", {
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  id: text("id").primaryKey(),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }).notNull(),
  name: text("name").notNull(),
});

export const members = sqliteTable(
  "members",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    displayName: text("display_name"),
    email: text("email"),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    id: text("id").primaryKey(),
    role: text("role", {
      enum: memberRoles,
    }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("members_role_check", sql`${table.role} in ('owner', 'member')`),
    index("members_household_idx").on(table.householdId),
  ],
);

export const userIdentities = sqliteTable(
  "user_identities",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    email: text("email"),
    id: text("id").primaryKey(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    provider: text("provider", {
      enum: authIdentityProviders,
    }).notNull(),
    providerUserId: text("provider_user_id").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "user_identities_provider_check",
      sql`${table.provider} in ('clerk')`,
    ),
    index("user_identities_member_idx").on(table.memberId),
    uniqueIndex("user_identities_provider_user_idx").on(
      table.provider,
      table.providerUserId,
    ),
  ],
);

export const providerConnections = sqliteTable(
  "provider_connections",
  {
    accessToken: text("access_token"),
    accessTokenEncrypted: text("access_token_encrypted"),
    accessSecret: text("access_secret"),
    accessSecretEncrypted: text("access_secret_encrypted"),
    accessUrl: text("access_url"),
    credentialKeyVersion: integer("credential_key_version").default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    externalConnectionId: text("external_connection_id").notNull(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    id: text("id").primaryKey(),
    institutionId: text("institution_id"),
    institutionName: text("institution_name"),
    plaidItemId: text("plaid_item_id"),
    provider: text("provider", {
      enum: providerTypes,
    }).notNull(),
    status: text("status", {
      enum: providerConnectionStatuses,
    }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "provider_connections_provider_check",
      sql`${table.provider} in ('plaid')`,
    ),
    check(
      "provider_connections_status_check",
      sql`${table.status} in ('active', 'disconnected', 'error')`,
    ),
    index("provider_connections_household_idx").on(table.householdId),
    uniqueIndex("provider_connections_provider_external_idx").on(
      table.provider,
      table.externalConnectionId,
    ),
  ],
);

export const providerAccounts = sqliteTable(
  "provider_accounts",
  {
    accountSubtype: text("account_subtype"),
    accountType: text("account_type", {
      enum: accountTypes,
    }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    currency: text("currency").notNull().default("USD"),
    id: text("id").primaryKey(),
    institutionName: text("institution_name").notNull(),
    name: text("name").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    providerConnectionId: text("provider_connection_id")
      .notNull()
      .references(() => providerConnections.id),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "provider_accounts_account_type_check",
      sql`${table.accountType} in ('checking', 'savings', 'credit_card', 'brokerage', 'retirement', 'mortgage', 'student_loan', 'loan', 'line_of_credit')`,
    ),
    index("provider_accounts_connection_idx").on(table.providerConnectionId),
    uniqueIndex("provider_accounts_connection_native_idx").on(
      table.providerConnectionId,
      table.providerAccountId,
    ),
  ],
);

export const accounts = sqliteTable(
  "accounts",
  {
    accountSubtype: text("account_subtype"),
    accountType: text("account_type", {
      enum: accountTypes,
    }).notNull(),
    balanceMinor: integer("balance_minor").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    currency: text("currency").notNull().default("USD"),
    displayName: text("display_name"),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    id: text("id").primaryKey(),
    includeInHouseholdReporting: integer("include_in_household_reporting", {
      mode: "boolean",
    })
      .notNull()
      .default(true),
    institutionName: text("institution_name").notNull(),
    isHidden: integer("is_hidden", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    name: text("name").notNull(),
    ownershipType: text("ownership_type", {
      enum: ownershipTypes,
    })
      .notNull()
      .default("joint"),
    providerAccountId: text("provider_account_id").references(
      () => providerAccounts.id,
    ),
    reportingGroup: text("reporting_group", {
      enum: reportingGroups,
    }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "accounts_account_type_check",
      sql`${table.accountType} in ('checking', 'savings', 'credit_card', 'brokerage', 'retirement', 'mortgage', 'student_loan', 'loan', 'line_of_credit')`,
    ),
    check(
      "accounts_reporting_group_check",
      sql`${table.reportingGroup} in ('cash', 'liabilities', 'investments')`,
    ),
    check(
      "accounts_reporting_group_matches_type_check",
      sql`(
      (${table.accountType} in ('checking', 'savings') and ${table.reportingGroup} = 'cash')
      or
      (${table.accountType} in ('credit_card', 'mortgage', 'student_loan', 'loan', 'line_of_credit') and ${table.reportingGroup} = 'liabilities')
      or
      (${table.accountType} in ('brokerage', 'retirement') and ${table.reportingGroup} = 'investments')
    )`,
    ),
    check(
      "accounts_ownership_type_check",
      sql`${table.ownershipType} in ('mine', 'wife', 'joint')`,
    ),
    check(
      "accounts_include_in_household_reporting_check",
      sql`${table.includeInHouseholdReporting} in (0, 1)`,
    ),
    check("accounts_is_hidden_check", sql`${table.isHidden} in (0, 1)`),
    uniqueIndex("accounts_provider_account_idx").on(table.providerAccountId),
  ],
);

export const syncRuns = sqliteTable(
  "sync_runs",
  {
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    errorSummary: text("error_summary"),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    id: text("id").primaryKey(),
    provider: text("provider", {
      enum: providerTypes,
    }),
    providerConnectionId: text("provider_connection_id").references(
      () => providerConnections.id,
    ),
    recordsChanged: integer("records_changed").notNull().default(0),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    status: text("status", {
      enum: syncRunStatuses,
    }).notNull(),
    trigger: text("trigger", {
      enum: syncRunTriggers,
    }).notNull(),
  },
  (table) => [
    check(
      "sync_runs_status_check",
      sql`${table.status} in ('running', 'succeeded', 'failed')`,
    ),
    check(
      "sync_runs_trigger_check",
      sql`${table.trigger} in ('seed', 'scheduled')`,
    ),
    check(
      "sync_runs_provider_check",
      sql`${table.provider} is null or ${table.provider} in ('plaid')`,
    ),
    index("sync_runs_household_idx").on(table.householdId),
    index("sync_runs_household_completed_idx").on(
      table.householdId,
      table.completedAt,
    ),
    index("sync_runs_connection_idx").on(table.providerConnectionId),
  ],
);

export const syncCheckpoints = sqliteTable(
  "sync_checkpoints",
  {
    cursor: text("cursor").notNull(),
    providerConnectionId: text("provider_connection_id")
      .primaryKey()
      .references(() => providerConnections.id),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("sync_checkpoints_updated_idx").on(table.updatedAt)],
);

export const balanceSnapshots = sqliteTable(
  "balance_snapshots",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    asOfDate: text("as_of_date").notNull(),
    balanceMinor: integer("balance_minor").notNull(),
    capturedAt: integer("captured_at", { mode: "timestamp_ms" }).notNull(),
    id: text("id").primaryKey(),
    sourceSyncRunId: text("source_sync_run_id")
      .notNull()
      .references(() => syncRuns.id),
  },
  (table) => [
    index("balance_snapshots_run_idx").on(table.sourceSyncRunId),
    index("balance_snapshots_account_idx").on(table.accountId),
    uniqueIndex("balance_snapshots_account_run_idx").on(
      table.accountId,
      table.sourceSyncRunId,
    ),
  ],
);

export const transactions = sqliteTable(
  "transactions",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    amountMinor: integer("amount_minor").notNull(),
    categoryNormalized: text("category_normalized"),
    categoryRaw: text("category_raw"),
    description: text("description").notNull(),
    direction: text("direction", {
      enum: transactionDirections,
    }).notNull(),
    excludeFromReporting: integer("exclude_from_reporting", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    id: text("id").primaryKey(),
    merchantName: text("merchant_name"),
    postedAt: integer("posted_at", { mode: "timestamp_ms" }).notNull(),
    providerTransactionId: text("provider_transaction_id").notNull(),
    sourceSyncRunId: text("source_sync_run_id")
      .notNull()
      .references(() => syncRuns.id),
  },
  (table) => [
    check(
      "transactions_direction_check",
      sql`${table.direction} in ('credit', 'debit')`,
    ),
    check(
      "transactions_exclude_from_reporting_check",
      sql`${table.excludeFromReporting} in (0, 1)`,
    ),
    index("transactions_account_posted_idx").on(
      table.accountId,
      table.postedAt,
    ),
    index("transactions_run_idx").on(table.sourceSyncRunId),
    uniqueIndex("transactions_account_provider_idx").on(
      table.accountId,
      table.providerTransactionId,
    ),
  ],
);

export const holdings = sqliteTable(
  "holdings",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    assetClass: text("asset_class", {
      enum: holdingAssetClasses,
    }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    currency: text("currency").notNull().default("USD"),
    holdingKey: text("holding_key").notNull(),
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    securityId: text("security_id"),
    subAssetClass: text("sub_asset_class"),
    symbol: text("symbol"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "holdings_asset_class_check",
      sql`${table.assetClass} in ('cash', 'equity', 'fixed_income', 'crypto', 'fund', 'other')`,
    ),
    index("holdings_account_idx").on(table.accountId),
    uniqueIndex("holdings_account_key_idx").on(
      table.accountId,
      table.holdingKey,
    ),
  ],
);

export const securities = sqliteTable(
  "securities",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    currency: text("currency").notNull().default("USD"),
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    priceSource: text("price_source", {
      enum: securityPriceSources,
    }).notNull(),
    provider: text("provider", {
      enum: providerTypes,
    }).notNull(),
    providerSecurityId: text("provider_security_id").notNull(),
    securitySubtype: text("security_subtype"),
    securityType: text("security_type"),
    symbol: text("symbol"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "securities_price_source_check",
      sql`${table.priceSource} in ('alpha_vantage', 'plaid_holdings', 'missing')`,
    ),
    check("securities_provider_check", sql`${table.provider} in ('plaid')`),
    uniqueIndex("securities_provider_security_idx").on(
      table.provider,
      table.providerSecurityId,
    ),
    index("securities_symbol_idx").on(table.symbol),
  ],
);

export const securityPriceDaily = sqliteTable(
  "security_price_daily",
  {
    closePriceMinor: integer("close_price_minor"),
    currency: text("currency").notNull().default("USD"),
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
    isEstimated: integer("is_estimated", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    priceDate: text("price_date").notNull(),
    securityId: text("security_id")
      .notNull()
      .references(() => securities.id),
    source: text("source", {
      enum: securityPriceSources,
    }).notNull(),
  },
  (table) => [
    check(
      "security_price_daily_source_check",
      sql`${table.source} in ('alpha_vantage', 'plaid_holdings', 'missing')`,
    ),
    check(
      "security_price_daily_is_estimated_check",
      sql`${table.isEstimated} in (0, 1)`,
    ),
    uniqueIndex("security_price_daily_security_date_idx").on(
      table.securityId,
      table.priceDate,
    ),
    index("security_price_daily_date_idx").on(table.priceDate),
  ],
);

export const investmentTransactions = sqliteTable(
  "investment_transactions",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull().default("USD"),
    feesMinor: integer("fees_minor"),
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    postedAt: integer("posted_at", { mode: "timestamp_ms" }).notNull(),
    priceMinor: integer("price_minor"),
    providerTransactionId: text("provider_transaction_id").notNull(),
    quantity: text("quantity").notNull(),
    securityId: text("security_id"),
    sourceSyncRunId: text("source_sync_run_id")
      .notNull()
      .references(() => syncRuns.id),
    subtype: text("subtype"),
    tradeAt: integer("trade_at", { mode: "timestamp_ms" }),
    type: text("type").notNull(),
  },
  (table) => [
    index("investment_transactions_account_posted_idx").on(
      table.accountId,
      table.postedAt,
    ),
    index("investment_transactions_run_idx").on(table.sourceSyncRunId),
    uniqueIndex("investment_transactions_account_provider_idx").on(
      table.accountId,
      table.providerTransactionId,
    ),
  ],
);

export const holdingSnapshots = sqliteTable(
  "holding_snapshots",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    asOfDate: text("as_of_date").notNull(),
    capturedAt: integer("captured_at", { mode: "timestamp_ms" }).notNull(),
    costBasisMinor: integer("cost_basis_minor"),
    holdingId: text("holding_id")
      .notNull()
      .references(() => holdings.id),
    id: text("id").primaryKey(),
    marketValueMinor: integer("market_value_minor").notNull(),
    priceMinor: integer("price_minor"),
    quantity: text("quantity").notNull(),
    sourceSyncRunId: text("source_sync_run_id")
      .notNull()
      .references(() => syncRuns.id),
  },
  (table) => [
    index("holding_snapshots_account_idx").on(table.accountId),
    index("holding_snapshots_run_idx").on(table.sourceSyncRunId),
    uniqueIndex("holding_snapshots_holding_run_idx").on(
      table.holdingId,
      table.sourceSyncRunId,
    ),
  ],
);

export const dailySecurityPositionFacts = sqliteTable(
  "daily_security_position_facts",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    costBasisMinor: integer("cost_basis_minor"),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    isEstimated: integer("is_estimated", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    positionDate: text("position_date").notNull(),
    quantity: text("quantity").notNull(),
    rebuiltAt: integer("rebuilt_at", { mode: "timestamp_ms" }).notNull(),
    securityId: text("security_id")
      .notNull()
      .references(() => securities.id),
    sourceWindowEnd: text("source_window_end").notNull(),
    sourceWindowStart: text("source_window_start").notNull(),
  },
  (table) => [
    check(
      "daily_security_position_facts_is_estimated_check",
      sql`${table.isEstimated} in (0, 1)`,
    ),
    uniqueIndex("daily_security_position_facts_account_security_date_idx").on(
      table.accountId,
      table.securityId,
      table.positionDate,
    ),
    index("daily_security_position_facts_household_date_idx").on(
      table.householdId,
      table.positionDate,
    ),
  ],
);

export const dailyInvestmentAccountValueFacts = sqliteTable(
  "daily_investment_account_value_facts",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    costBasisMinor: integer("cost_basis_minor").notNull().default(0),
    factDate: text("fact_date").notNull(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    isEstimated: integer("is_estimated", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    marketValueMinor: integer("market_value_minor").notNull().default(0),
    missingPriceCount: integer("missing_price_count").notNull().default(0),
    pricedPositionCount: integer("priced_position_count").notNull().default(0),
    rebuiltAt: integer("rebuilt_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "daily_investment_account_value_facts_is_estimated_check",
      sql`${table.isEstimated} in (0, 1)`,
    ),
    uniqueIndex("daily_investment_account_value_facts_account_date_idx").on(
      table.accountId,
      table.factDate,
    ),
    index("daily_investment_account_value_facts_household_date_idx").on(
      table.householdId,
      table.factDate,
    ),
  ],
);

export const dailyNetWorthFacts = sqliteTable(
  "daily_net_worth_facts",
  {
    cashMinor: integer("cash_minor").notNull().default(0),
    coverageMode: text("coverage_mode", {
      enum: netWorthCoverageModes,
    }).notNull(),
    factDate: text("fact_date").notNull(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    investmentsMinor: integer("investments_minor").notNull().default(0),
    isEstimated: integer("is_estimated", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    liabilitiesMinor: integer("liabilities_minor").notNull().default(0),
    netWorthMinor: integer("net_worth_minor").notNull().default(0),
    rebuiltAt: integer("rebuilt_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "daily_net_worth_facts_coverage_mode_check",
      sql`${table.coverageMode} in ('snapshot_only', 'investments_backfilled', 'mixed_snapshot_and_backfill')`,
    ),
    check(
      "daily_net_worth_facts_is_estimated_check",
      sql`${table.isEstimated} in (0, 1)`,
    ),
    uniqueIndex("daily_net_worth_facts_household_date_idx").on(
      table.householdId,
      table.factDate,
    ),
  ],
);
