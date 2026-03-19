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
        "Run bun run db:seed:local to load the demo household before exercising the sync worker locally.",
      status: "waiting_for_seed",
      syncedHousehold: null,
    });
  });

  test("fetch stays in waiting_for_seed until a successful run exists", async () => {
    const { d1, sqlite } = createSeededSyncDatabase();
    sqlite.exec("delete from holding_snapshots");
    sqlite.exec("delete from balance_snapshots");
    sqlite.exec("delete from sync_runs");

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

  test("scheduled prefers configured SimpleFIN connections over the demo fixture path", async () => {
    const { d1, sqlite } = createEmptySyncDatabase();
    const createdAt = new Date("2026-03-15T12:00:00.000Z").getTime();
    const nowEpochSeconds = Math.floor(
      new Date("2026-03-18T18:30:00.000Z").getTime() / 1000,
    );

    sqlite
      .query(
        `
          insert into households (id, name, last_synced_at, created_at)
          values (?, ?, ?, ?)
        `,
      )
      .run("household_demo", "Vista Household", createdAt, createdAt);
    sqlite
      .query(
        `
          insert into provider_connections (
            id,
            household_id,
            provider,
            status,
            external_connection_id,
            access_url,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "conn_simplefin_us_bank",
        "household_demo",
        "simplefin",
        "active",
        "simplefin-us-bank",
        "https://demo-user:demo-pass@bridge.example/simplefin",
        createdAt,
        createdAt,
      );

    const fetchMock = mock(async () => {
      return new Response(
        JSON.stringify({
          accounts: [
            {
              balance: "1023.45",
              "balance-date": nowEpochSeconds,
              currency: "USD",
              id: "checking-123",
              name: "Everyday Checking",
              org: {
                domain: "usbank.com",
                name: "US Bank",
                "sfin-url": "https://bridge.simplefin.org/simplefin",
              },
              transactions: [],
            },
          ],
          errors: [],
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      );
    });
    const originalFetch = globalThis.fetch;
    const consoleLog = mock(() => {});
    const originalConsoleLog = console.log;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    console.log = consoleLog;

    try {
      await worker.scheduled(
        { cron: "0 13 * * *" } as ScheduledEvent,
        { DB: d1 } as Env,
      );
    } finally {
      globalThis.fetch = originalFetch;
      console.log = originalConsoleLog;
    }

    expect(
      sqlite.query("select count(*) as count from sync_runs").get(),
    ).toEqual({ count: 1 });
    expect(
      sqlite
        .query(
          "select count(*) as count from provider_accounts where provider_connection_id = ?",
        )
        .get("conn_simplefin_us_bank"),
    ).toEqual({ count: 1 });
    expect(
      sqlite
        .query(
          "select count(*) as count from balance_snapshots where source_sync_run_id not like 'sync_demo_%'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(consoleLog).toHaveBeenCalledTimes(1);
    const firstConsoleCall = (
      consoleLog.mock.calls as unknown as Array<unknown[]>
    )[0];
    const loggedPayload = String(firstConsoleCall?.[0] ?? "");
    expect(loggedPayload).toContain('"syncedConnections":1');
    expect(loggedPayload).toContain('"usedFixtureData":false');
  });
});
