import type { SyncRunTrigger } from "./schema";

export type FixtureBalanceSnapshotRow = {
  accountId: string;
  asOfDate: string;
  balanceMinor: number;
  capturedAt: Date;
  id: string;
};

export type FixtureSyncBatch = {
  balances: FixtureBalanceSnapshotRow[];
  completedAt: Date;
  householdId: string;
  runId: string;
  startedAt: Date;
  trigger: SyncRunTrigger;
};
