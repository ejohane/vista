import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const households = sqliteTable("households", {
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  id: text("id").primaryKey(),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }).notNull(),
  name: text("name").notNull(),
});

export const accounts = sqliteTable("accounts", {
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
});
