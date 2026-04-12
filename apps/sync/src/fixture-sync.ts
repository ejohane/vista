import { type FixtureSyncBatch, ingestFixtureSyncBatch } from "@vista/db";

export { ingestFixtureSyncBatch };

export const demoSyncBatch: FixtureSyncBatch = {
  balances: [
    {
      accountId: "acct_checking",
      asOfDate: "2026-03-17",
      balanceMinor: 1102300,
      capturedAt: new Date("2026-03-17T18:30:00.000Z"),
      id: "snapshot_sync_demo_2026_03_17_acct_checking",
    },
    {
      accountId: "acct_savings",
      asOfDate: "2026-03-17",
      balanceMinor: 3880100,
      capturedAt: new Date("2026-03-17T18:30:00.000Z"),
      id: "snapshot_sync_demo_2026_03_17_acct_savings",
    },
    {
      accountId: "acct_brokerage",
      asOfDate: "2026-03-17",
      balanceMinor: 16910450,
      capturedAt: new Date("2026-03-17T18:30:00.000Z"),
      id: "snapshot_sync_demo_2026_03_17_acct_brokerage",
    },
    {
      accountId: "acct_retirement",
      asOfDate: "2026-03-17",
      balanceMinor: 24150000,
      capturedAt: new Date("2026-03-17T18:30:00.000Z"),
      id: "snapshot_sync_demo_2026_03_17_acct_retirement",
    },
  ],
  completedAt: new Date("2026-03-17T18:30:00.000Z"),
  householdId: "household_demo",
  runId: "sync_demo_2026_03_17",
  startedAt: new Date("2026-03-17T18:25:00.000Z"),
  trigger: "scheduled",
};

export function ingestDemoSyncBatch(database: D1Database) {
  return ingestFixtureSyncBatch(database, demoSyncBatch);
}
