import { describe, expect, mock, test } from "bun:test";

import worker from "./index";
import {
  createEmptySyncDatabase,
  createSeededSyncDatabase,
} from "./test-helpers";

describe("sync worker", () => {
  test("fetch reports waiting_for_seed when no household snapshot exists", async () => {
    const { d1 } = createEmptySyncDatabase();

    const response = await worker.fetch(new Request("http://127.0.0.1:8788/"), {
      DB: d1,
    } as Env);
    const body = (await response.json()) as {
      nextStep: string;
      status: string;
      syncedHousehold: string | null;
    };

    expect(body).toEqual({
      nextStep:
        'Run curl "http://127.0.0.1:8788/__scheduled?cron=0+13+*+*+*" to exercise the scheduled handler locally.',
      status: "waiting_for_seed",
      syncedHousehold: null,
    });
  });

  test("scheduled adds the demo run once and logs createdRun state", async () => {
    const { d1, sqlite } = createSeededSyncDatabase();
    const consoleLog = mock(() => {});
    const originalConsoleLog = console.log;
    console.log = consoleLog;

    try {
      await worker.scheduled(
        { cron: "0 13 * * *" } as ScheduledEvent,
        { DB: d1 } as Env,
      );
      await worker.scheduled(
        { cron: "0 13 * * *" } as ScheduledEvent,
        { DB: d1 } as Env,
      );
    } finally {
      console.log = originalConsoleLog;
    }

    expect(
      sqlite
        .query("select count(*) as count from sync_runs where id = ?")
        .get("sync_demo_2026_03_17"),
    ).toEqual({ count: 1 });
    expect(
      sqlite
        .query(
          "select count(*) as count from balance_snapshots where source_sync_run_id = ?",
        )
        .get("sync_demo_2026_03_17"),
    ).toEqual({ count: 4 });
    expect(consoleLog).toHaveBeenNthCalledWith(
      1,
      JSON.stringify({
        createdRun: true,
        cron: "0 13 * * *",
        household: "Vista Household",
        lastSyncedAt: "2026-03-17T18:30:00.000Z",
        netWorthMinor: 46042850,
        runId: "sync_demo_2026_03_17",
      }),
    );
    expect(consoleLog).toHaveBeenNthCalledWith(
      2,
      JSON.stringify({
        createdRun: false,
        cron: "0 13 * * *",
        household: "Vista Household",
        lastSyncedAt: "2026-03-17T18:30:00.000Z",
        netWorthMinor: 46042850,
        runId: "sync_demo_2026_03_17",
      }),
    );
  });
});
