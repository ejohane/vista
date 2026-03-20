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

export const providerTypes = ["simplefin", "snaptrade"] as const;
export type ProviderType = (typeof providerTypes)[number];

export const providerConnectionStatuses = [
  "active",
  "disconnected",
  "error",
] as const;
export type ProviderConnectionStatus =
  (typeof providerConnectionStatuses)[number];

export const ownershipTypes = ["mine", "wife", "joint"] as const;
export type OwnershipType = (typeof ownershipTypes)[number];

export const transactionDirections = ["credit", "debit"] as const;
export type TransactionDirection = (typeof transactionDirections)[number];

export const holdingAssetClasses = [
  "cash",
  "equity",
  "fixed_income",
  "crypto",
  "fund",
  "other",
] as const;
export type HoldingAssetClass = (typeof holdingAssetClasses)[number];

export const households = sqliteTable("households", {
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  id: text("id").primaryKey(),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }).notNull(),
  name: text("name").notNull(),
});

export const providerConnections = sqliteTable(
  "provider_connections",
  {
    accessSecret: text("access_secret"),
    accessUrl: text("access_url"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    externalConnectionId: text("external_connection_id").notNull(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    id: text("id").primaryKey(),
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
      sql`${table.provider} in ('simplefin', 'snaptrade')`,
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
      enum: ["checking", "savings", "brokerage", "retirement"],
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
      sql`${table.accountType} in ('checking', 'savings', 'brokerage', 'retirement')`,
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
      enum: ["checking", "savings", "brokerage", "retirement"],
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
      enum: ["cash", "investments"],
    }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "accounts_account_type_check",
      sql`${table.accountType} in ('checking', 'savings', 'brokerage', 'retirement')`,
    ),
    check(
      "accounts_reporting_group_check",
      sql`${table.reportingGroup} in ('cash', 'investments')`,
    ),
    check(
      "accounts_reporting_group_matches_type_check",
      sql`(
      (${table.accountType} in ('checking', 'savings') and ${table.reportingGroup} = 'cash')
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
      sql`${table.provider} is null or ${table.provider} in ('simplefin', 'snaptrade')`,
    ),
    index("sync_runs_household_idx").on(table.householdId),
    index("sync_runs_household_completed_idx").on(
      table.householdId,
      table.completedAt,
    ),
    index("sync_runs_connection_idx").on(table.providerConnectionId),
  ],
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

export const syncCheckpoints = sqliteTable(
  "sync_checkpoints",
  {
    cursor: text("cursor"),
    id: text("id").primaryKey(),
    providerConnectionId: text("provider_connection_id")
      .notNull()
      .references(() => providerConnections.id),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("sync_checkpoints_connection_idx").on(
      table.providerConnectionId,
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
