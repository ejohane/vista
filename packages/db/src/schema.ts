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

export const households = sqliteTable("households", {
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  id: text("id").primaryKey(),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }).notNull(),
  name: text("name").notNull(),
});

export const accounts = sqliteTable(
  "accounts",
  {
    accountType: text("account_type", {
      enum: ["checking", "savings", "brokerage", "retirement"],
    }).notNull(),
    balanceMinor: integer("balance_minor").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    id: text("id").primaryKey(),
    institutionName: text("institution_name").notNull(),
    name: text("name").notNull(),
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
  ],
);

export const syncRuns = sqliteTable(
  "sync_runs",
  {
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    id: text("id").primaryKey(),
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
    index("sync_runs_household_idx").on(table.householdId),
    index("sync_runs_household_completed_idx").on(
      table.householdId,
      table.completedAt,
    ),
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
