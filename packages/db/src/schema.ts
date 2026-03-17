import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
