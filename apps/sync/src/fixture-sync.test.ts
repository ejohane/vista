import { describe, expect, test } from "bun:test";

import {
  demoSyncBatch,
  ingestDemoSyncBatch,
  ingestFixtureSyncBatch,
} from "./fixture-sync";
import { createSeededSyncDatabase } from "./test-helpers";

describe("ingestFixtureSyncBatch", () => {
  test("creates the demo run once and keeps repeated scheduled runs idempotent", async () => {
    const { d1, sqlite } = createSeededSyncDatabase();

    const firstResult = await ingestDemoSyncBatch(d1);

    expect(firstResult).toEqual({
      completedAt: new Date("2026-03-17T18:30:00.000Z"),
      created: true,
      runId: "sync_demo_2026_03_17",
    });
    expect(
      sqlite
        .query("select count(*) as count from sync_runs where id = ?")
        .get(demoSyncBatch.runId),
    ).toEqual({ count: 1 });
    expect(
      sqlite
        .query(
          "select count(*) as count from balance_snapshots where source_sync_run_id = ?",
        )
        .get(demoSyncBatch.runId),
    ).toEqual({ count: 4 });
    expect(
      sqlite
        .query(
          "select balance_minor as balanceMinor from accounts where id = ?",
        )
        .get("acct_brokerage"),
    ).toEqual({ balanceMinor: 16910450 });

    const secondResult = await ingestDemoSyncBatch(d1);

    expect(secondResult).toEqual({
      completedAt: new Date("2026-03-17T18:30:00.000Z"),
      created: false,
      runId: "sync_demo_2026_03_17",
    });
    expect(
      sqlite
        .query("select count(*) as count from sync_runs where id = ?")
        .get(demoSyncBatch.runId),
    ).toEqual({ count: 1 });
  });

  test("marks failed runs and leaves no partial snapshots behind when the batch fails", async () => {
    const { d1, sqlite } = createSeededSyncDatabase();
    const invalidBatch = {
      ...demoSyncBatch,
      balances: demoSyncBatch.balances.map((balance, index) =>
        index === 0
          ? {
              ...balance,
              accountId: "acct_missing",
            }
          : balance,
      ),
      runId: "sync_demo_failure_2026_03_17",
    };

    await expect(ingestFixtureSyncBatch(d1, invalidBatch)).rejects.toThrow();

    expect(
      sqlite
        .query(
          "select status, completed_at as completedAt from sync_runs where id = ?",
        )
        .get(invalidBatch.runId),
    ).toEqual({
      completedAt: invalidBatch.completedAt.getTime(),
      status: "failed",
    });
    expect(
      sqlite
        .query(
          "select count(*) as count from balance_snapshots where source_sync_run_id = ?",
        )
        .get(invalidBatch.runId),
    ).toEqual({ count: 0 });
  });
});
