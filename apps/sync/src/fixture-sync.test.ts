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

  test("keeps concurrent attempts idempotent for the shared demo run id", async () => {
    const { d1, sqlite } = createSeededSyncDatabase();

    const results = await Promise.all([
      ingestDemoSyncBatch(d1),
      ingestDemoSyncBatch(d1),
    ]);

    expect(results).toContainEqual({
      completedAt: new Date("2026-03-17T18:30:00.000Z"),
      created: true,
      runId: "sync_demo_2026_03_17",
    });
    expect(results).toContainEqual({
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

  test("retries a failed run id instead of leaving it wedged forever", async () => {
    const { d1, sqlite } = createSeededSyncDatabase();
    const failedRunId = "sync_demo_retry_2026_03_17";
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
      runId: failedRunId,
    };
    const recoveredBatch = {
      ...demoSyncBatch,
      runId: failedRunId,
    };

    await expect(ingestFixtureSyncBatch(d1, invalidBatch)).rejects.toThrow();

    const recoveredResult = await ingestFixtureSyncBatch(d1, recoveredBatch);

    expect(recoveredResult).toEqual({
      completedAt: new Date("2026-03-17T18:30:00.000Z"),
      created: true,
      runId: failedRunId,
    });
    expect(
      sqlite
        .query(
          "select status, completed_at as completedAt from sync_runs where id = ?",
        )
        .get(failedRunId),
    ).toEqual({
      completedAt: recoveredBatch.completedAt.getTime(),
      status: "succeeded",
    });
    expect(
      sqlite
        .query(
          "select count(*) as count from balance_snapshots where source_sync_run_id = ?",
        )
        .get(failedRunId),
    ).toEqual({ count: 4 });
  });

  test("rejects batches that reference accounts outside the batch household", async () => {
    const { d1, sqlite } = createSeededSyncDatabase();
    sqlite
      .query(
        `
          insert into households (id, name, last_synced_at, created_at)
          values (?, ?, ?, ?)
        `,
      )
      .run(
        "household_other",
        "Other Household",
        demoSyncBatch.completedAt.getTime(),
        demoSyncBatch.startedAt.getTime(),
      );
    sqlite
      .query(
        `
          insert into accounts (
            id,
            household_id,
            name,
            institution_name,
            account_type,
            reporting_group,
            balance_minor,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "acct_other",
        "household_other",
        "Elsewhere Checking",
        "Chase",
        "checking",
        "cash",
        99900,
        demoSyncBatch.startedAt.getTime(),
        demoSyncBatch.completedAt.getTime(),
      );

    const invalidBatch = {
      ...demoSyncBatch,
      balances: demoSyncBatch.balances.map((balance, index) =>
        index === 0
          ? {
              ...balance,
              accountId: "acct_other",
            }
          : balance,
      ),
      runId: "sync_demo_cross_household_2026_03_17",
    };

    await expect(ingestFixtureSyncBatch(d1, invalidBatch)).rejects.toThrow(
      "accounts outside household",
    );

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
          "select balance_minor as balanceMinor from accounts where id = ?",
        )
        .get("acct_other"),
    ).toEqual({ balanceMinor: 99900 });
    expect(
      sqlite
        .query(
          "select count(*) as count from balance_snapshots where source_sync_run_id = ?",
        )
        .get(invalidBatch.runId),
    ).toEqual({ count: 0 });
  });
});
