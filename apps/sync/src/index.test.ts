import { describe, expect, mock, test } from "bun:test";

import worker from "./index";
import {
  createEmptySyncDatabase,
  createSeededSyncDatabase,
} from "./test-helpers";

describe("sync worker", () => {
  test("fetch reports setup guidance when no household snapshot exists", async () => {
    const { d1 } = createEmptySyncDatabase();

    const response = await worker.fetch(new Request("http://127.0.0.1:8788/"), {
      DB: d1,
    } as unknown as Env);
    const body = (await response.json()) as {
      nextStep: string;
      status: string;
      syncedHousehold: string | null;
    };

    expect(body).toEqual({
      nextStep:
        "Connect a Plaid account to start syncing, or run bun run db:seed:local if you want demo data locally.",
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
    } as unknown as Env);
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
    sqlite.exec(
      `
        update provider_connections
        set status = 'disconnected',
            access_token = null
      `,
    );
    const consoleLog = mock(() => {});
    const originalConsoleLog = console.log;
    console.log = consoleLog;

    try {
      await worker.scheduled(
        { cron: "0 13 * * *" } as ScheduledEvent,
        { DB: d1 } as unknown as Env,
      );
      await worker.scheduled(
        { cron: "0 13 * * *" } as ScheduledEvent,
        { DB: d1 } as unknown as Env,
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

  test("scheduled leaves an empty database untouched until Plaid is connected", async () => {
    const { d1, sqlite } = createEmptySyncDatabase();
    const consoleLog = mock(() => {});
    const originalConsoleLog = console.log;
    console.log = consoleLog;

    try {
      await worker.scheduled(
        { cron: "0 13 * * *" } as ScheduledEvent,
        { DB: d1 } as unknown as Env,
      );
    } finally {
      console.log = originalConsoleLog;
    }

    expect(
      sqlite.query("select count(*) as count from sync_runs").get(),
    ).toEqual({
      count: 0,
    });
    expect(consoleLog).toHaveBeenCalledWith(
      JSON.stringify({
        cron: "0 13 * * *",
        household: null,
        lastSyncedAt: null,
        netWorthMinor: null,
        runId: null,
        awaitingInitialConnection: true,
        syncedConnections: 0,
        usedFixtureData: false,
      }),
    );
  });

  test("scheduled prefers configured Plaid connections over the demo fixture path", async () => {
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
            access_token,
            institution_name,
            plaid_item_id,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "conn_plaid_us_bank",
        "household_demo",
        "plaid",
        "active",
        "plaid-us-bank",
        "access-us-bank-demo",
        "US Bank",
        "item-us-bank-demo",
        createdAt,
        createdAt,
      );

    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const requestUrl = new URL(String(input));

      if (requestUrl.pathname === "/transactions/sync") {
        return new Response(
          JSON.stringify({
            accounts: [],
            added: [],
            has_more: false,
            modified: [],
            next_cursor: "cursor-1",
            removed: [],
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        );
      }

      expect(requestUrl.pathname).toBe("/accounts/get");

      return new Response(
        JSON.stringify({
          accounts: [
            {
              account_id: "checking-123",
              balances: {
                available: 1023.45,
                current: 1023.45,
                iso_currency_code: "USD",
              },
              name: "Everyday Checking",
              official_name: "US Bank Platinum Checking",
              subtype: "checking",
              type: "depository",
            },
          ],
          item: {
            institution_id: "ins_us_bank",
            item_id: "item-us-bank-demo",
          },
          request_id: `request-${nowEpochSeconds}`,
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
        {
          DB: d1,
          PLAID_CLIENT_ID: "client-demo",
          PLAID_ENV: "sandbox",
          PLAID_SECRET: "secret-demo",
        } as unknown as Env,
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
        .get("conn_plaid_us_bank"),
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

  test("scheduled does not fall back to fixture data when a configured Plaid connection fails", async () => {
    const { d1, sqlite } = createEmptySyncDatabase();
    const createdAt = new Date("2026-03-15T12:00:00.000Z").getTime();

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
            access_token,
            institution_name,
            plaid_item_id,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "conn_plaid_broken",
        "household_demo",
        "plaid",
        "active",
        "plaid-broken",
        "access-broken-demo",
        "US Bank",
        "item-broken-demo",
        createdAt,
        createdAt,
      );

    const fetchMock = mock(async () => {
      return new Response("forbidden", { status: 403 });
    });
    const originalFetch = globalThis.fetch;
    const consoleLog = mock(() => {});
    const originalConsoleLog = console.log;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    console.log = consoleLog;

    try {
      await worker.scheduled(
        { cron: "0 13 * * *" } as ScheduledEvent,
        {
          DB: d1,
          PLAID_CLIENT_ID: "client-demo",
          PLAID_ENV: "sandbox",
          PLAID_SECRET: "secret-demo",
        } as unknown as Env,
      );
    } finally {
      globalThis.fetch = originalFetch;
      console.log = originalConsoleLog;
    }

    expect(
      sqlite
        .query(
          "select count(*) as count from sync_runs where id like 'sync_demo_%'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite
        .query(
          "select count(*) as count from sync_runs where status = 'failed'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(consoleLog).toHaveBeenCalledTimes(1);
    const firstConsoleCall = (
      consoleLog.mock.calls as unknown as Array<unknown[]>
    )[0];
    const loggedPayload = String(firstConsoleCall?.[0] ?? "");
    expect(loggedPayload).toContain('"syncedConnections":0');
    expect(loggedPayload).toContain('"usedFixtureData":false');
  });

  test("scheduled backfills investment history for synced households when Alpha Vantage is configured", async () => {
    const { d1, sqlite } = createEmptySyncDatabase();
    const createdAt = new Date("2026-04-10T18:30:00.000Z").getTime();

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
            access_token,
            institution_name,
            plaid_item_id,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "conn_plaid_investments",
        "household_demo",
        "plaid",
        "active",
        "plaid-investments-demo",
        "access-investments-demo",
        "Vanguard",
        "item-investments-demo",
        createdAt,
        createdAt,
      );

    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const requestUrl = new URL(String(input));

      if (requestUrl.hostname === "www.alphavantage.co") {
        return new Response(
          JSON.stringify({
            "Time Series (Daily)": {
              "2026-04-10": {
                "4. close": "276.11",
                "5. adjusted close": "276.11",
              },
              "2026-04-09": {
                "4. close": "275.10",
                "5. adjusted close": "275.10",
              },
              "2026-04-08": {
                "4. close": "274.32",
                "5. adjusted close": "274.32",
              },
            },
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        );
      }

      if (requestUrl.pathname === "/accounts/get") {
        return new Response(
          JSON.stringify({
            accounts: [
              {
                account_id: "investment-123",
                balances: {
                  current: 2761.1,
                  iso_currency_code: "USD",
                },
                name: "Brokerage",
                official_name: "Vanguard Brokerage",
                subtype: "brokerage",
                type: "investment",
              },
            ],
            item: {
              institution_id: "ins_vanguard",
              item_id: "item-investments-demo",
            },
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        );
      }

      if (requestUrl.pathname === "/investments/holdings/get") {
        return new Response(
          JSON.stringify({
            accounts: [],
            holdings: [
              {
                account_id: "investment-123",
                cost_basis: 2500,
                institution_price: 276.11,
                institution_price_as_of: "2026-04-10",
                institution_price_datetime: "2026-04-10T18:30:00.000Z",
                institution_value: 2761.1,
                iso_currency_code: "USD",
                quantity: 10,
                security_id: "security-vti",
              },
            ],
            securities: [
              {
                is_cash_equivalent: false,
                iso_currency_code: "USD",
                name: "Vanguard Total Stock Market ETF",
                security_id: "security-vti",
                subtype: "etf",
                ticker_symbol: "VTI",
                type: "etf",
              },
            ],
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        );
      }

      if (requestUrl.pathname === "/investments/transactions/get") {
        return new Response(
          JSON.stringify({
            investment_transactions: [
              {
                account_id: "investment-123",
                amount: 274.32,
                date: "2026-04-08",
                fees: null,
                investment_transaction_id: "invtxn-1",
                iso_currency_code: "USD",
                name: "BUY Vanguard Total Stock Market ETF",
                price: 274.32,
                quantity: 1,
                security_id: "security-vti",
                subtype: "buy",
                transaction_datetime: "2026-04-08T15:00:00.000Z",
                type: "buy",
              },
            ],
            total_investment_transactions: 1,
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        );
      }

      if (requestUrl.pathname === "/transactions/sync") {
        return new Response(
          JSON.stringify({
            accounts: [],
            added: [],
            has_more: false,
            modified: [],
            next_cursor: "cursor-investments-demo",
            removed: [],
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        );
      }

      throw new Error(`Unexpected fetch call: ${requestUrl.href}`);
    });
    const originalFetch = globalThis.fetch;
    const consoleLog = mock(() => {});
    const originalConsoleLog = console.log;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    console.log = consoleLog;

    try {
      await worker.scheduled(
        { cron: "0 13 * * *" } as ScheduledEvent,
        {
          ALPHA_VANTAGE_API_KEY: "alpha-demo",
          DB: d1,
          PLAID_CLIENT_ID: "client-demo",
          PLAID_ENV: "sandbox",
          PLAID_SECRET: "secret-demo",
        } as unknown as Env,
      );
    } finally {
      globalThis.fetch = originalFetch;
      console.log = originalConsoleLog;
    }

    expect(
      sqlite.query("select count(*) as count from daily_net_worth_facts").get(),
    ).toEqual({ count: 5 });
    expect(
      sqlite.query("select count(*) as count from security_price_daily").get(),
    ).toEqual({ count: 3 });
    expect(consoleLog).toHaveBeenCalledTimes(1);
    const firstConsoleCall = (
      consoleLog.mock.calls as unknown as Array<unknown[]>
    )[0];
    const loggedPayload = String(firstConsoleCall?.[0] ?? "");
    expect(loggedPayload).toContain('"backfilledHouseholds":1');
    expect(loggedPayload).toContain('"rebuiltNetWorthFacts":5');
    expect(loggedPayload).toContain('"importedPrices":3');
  });
});
