import { describe, expect, mock, test } from "bun:test";

import { syncSimplefinConnection } from "./simplefin-sync";
import { createEmptySyncDatabase } from "./test-helpers";

const now = new Date("2026-03-18T18:30:00.000Z");

function seedSimplefinConnection(
  sqlite: ReturnType<typeof createEmptySyncDatabase>["sqlite"],
  values?: {
    accessUrl?: string;
    householdId?: string;
  },
) {
  const householdId = values?.householdId ?? "household_demo";
  const createdAt = new Date("2026-03-15T12:00:00.000Z").getTime();

  sqlite
    .query(
      `
        insert into households (id, name, last_synced_at, created_at)
        values (?, ?, ?, ?)
      `,
    )
    .run(householdId, "Vista Household", createdAt, createdAt);
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
      householdId,
      "simplefin",
      "active",
      "simplefin-us-bank",
      values?.accessUrl ??
        "https://demo-user:demo-pass@bridge.example/simplefin",
      createdAt,
      createdAt,
    );
}

describe("syncSimplefinConnection", () => {
  test("fetches SimpleFIN accounts and writes provider accounts, canonical accounts, snapshots, transactions, and a checkpoint", async () => {
    const { d1, sqlite } = createEmptySyncDatabase();
    seedSimplefinConnection(sqlite);
    const nowEpochSeconds = Math.floor(now.getTime() / 1000);
    const expectedStartDate = String(nowEpochSeconds - 90 * 24 * 60 * 60);
    const expectedEndDate = String(nowEpochSeconds);

    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl = new URL(String(input));
        const authorization = new Headers(init?.headers).get("authorization");

        expect(requestUrl.origin).toBe("https://bridge.example");
        expect(requestUrl.pathname).toBe("/simplefin/accounts");
        expect(requestUrl.searchParams.get("start-date")).toBe(
          expectedStartDate,
        );
        expect(requestUrl.searchParams.get("end-date")).toBe(expectedEndDate);
        expect(authorization).toBe("Basic ZGVtby11c2VyOmRlbW8tcGFzcw==");

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
                transactions: [
                  {
                    amount: "-45.67",
                    description: "Coffee Shop",
                    extra: { category: "food" },
                    id: "txn-1",
                    posted: nowEpochSeconds - 2 * 24 * 60 * 60,
                  },
                ],
              },
              {
                balance: "2500.00",
                "balance-date": nowEpochSeconds,
                currency: "USD",
                id: "savings-456",
                name: "Rainy Day Savings",
                org: {
                  domain: "usbank.com",
                  name: "US Bank",
                  "sfin-url": "https://bridge.simplefin.org/simplefin",
                },
                transactions: [
                  {
                    amount: "250.00",
                    description: "Transfer From Checking",
                    id: "txn-2",
                    posted: nowEpochSeconds - 24 * 60 * 60,
                  },
                ],
              },
            ],
            errors: [],
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        );
      },
    );

    const result = await syncSimplefinConnection({
      connectionId: "conn_simplefin_us_bank",
      database: d1,
      fetchImpl: fetchMock as unknown as typeof fetch,
      now,
    });

    expect(result.status).toBe("succeeded");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      sqlite
        .query(
          `
            select count(*) as count
            from provider_accounts
            where provider_connection_id = ?
          `,
        )
        .get("conn_simplefin_us_bank"),
    ).toEqual({ count: 2 });
    expect(
      sqlite
        .query(
          `
            select
              id,
              provider_account_id as providerAccountId,
              name,
              account_type as accountType,
              reporting_group as reportingGroup,
              balance_minor as balanceMinor
            from accounts
            order by id
          `,
        )
        .all(),
    ).toEqual([
      {
        accountType: "checking",
        balanceMinor: 102345,
        id: "acct:simplefin:conn_simplefin_us_bank:checking-123",
        name: "Everyday Checking",
        providerAccountId:
          "provacct:simplefin:conn_simplefin_us_bank:checking-123",
        reportingGroup: "cash",
      },
      {
        accountType: "savings",
        balanceMinor: 250000,
        id: "acct:simplefin:conn_simplefin_us_bank:savings-456",
        name: "Rainy Day Savings",
        providerAccountId:
          "provacct:simplefin:conn_simplefin_us_bank:savings-456",
        reportingGroup: "cash",
      },
    ]);
    expect(
      sqlite
        .query(
          `
            select count(*) as count
            from balance_snapshots
            where source_sync_run_id = ?
          `,
        )
        .get(result.runId),
    ).toEqual({ count: 2 });
    expect(
      sqlite
        .query(
          `
            select
              account_id as accountId,
              provider_transaction_id as providerTransactionId,
              amount_minor as amountMinor,
              direction,
              category_raw as categoryRaw
            from transactions
            order by provider_transaction_id
          `,
        )
        .all(),
    ).toEqual([
      {
        accountId: "acct:simplefin:conn_simplefin_us_bank:checking-123",
        amountMinor: -4567,
        categoryRaw: "food",
        direction: "debit",
        providerTransactionId: "txn-1",
      },
      {
        accountId: "acct:simplefin:conn_simplefin_us_bank:savings-456",
        amountMinor: 25000,
        categoryRaw: null,
        direction: "credit",
        providerTransactionId: "txn-2",
      },
    ]);
    expect(
      sqlite
        .query(
          `
            select
              provider_connection_id as providerConnectionId,
              cursor
            from sync_checkpoints
          `,
        )
        .get(),
    ).toEqual({
      cursor: expectedEndDate,
      providerConnectionId: "conn_simplefin_us_bank",
    });
    expect(
      sqlite
        .query(
          `
            select
              provider,
              provider_connection_id as providerConnectionId,
              records_changed as recordsChanged,
              status
            from sync_runs
            where id = ?
          `,
        )
        .get(result.runId),
    ).toEqual({
      provider: "simplefin",
      providerConnectionId: "conn_simplefin_us_bank",
      recordsChanged: 6,
      status: "succeeded",
    });
  });

  test("marks the sync run failed and does not advance the checkpoint when SimpleFIN rejects the access token", async () => {
    const { d1, sqlite } = createEmptySyncDatabase();
    seedSimplefinConnection(sqlite);
    sqlite
      .query(
        `
          insert into sync_checkpoints (
            id,
            provider_connection_id,
            cursor,
            updated_at
          )
          values (?, ?, ?, ?)
        `,
      )
      .run(
        "checkpoint_simplefin_us_bank",
        "conn_simplefin_us_bank",
        "1742100000",
        new Date("2026-03-17T18:30:00.000Z").getTime(),
      );

    const fetchMock = mock(async () => {
      return new Response("forbidden", { status: 403 });
    });

    await expect(
      syncSimplefinConnection({
        connectionId: "conn_simplefin_us_bank",
        database: d1,
        fetchImpl: fetchMock as unknown as typeof fetch,
        now,
      }),
    ).rejects.toThrow("403");

    expect(
      sqlite
        .query(
          `
            select
              status,
              error_summary as errorSummary
            from sync_runs
            order by started_at desc
            limit 1
          `,
        )
        .get(),
    ).toEqual({
      errorSummary:
        "SimpleFIN /accounts returned 403 for connection conn_simplefin_us_bank.",
      status: "failed",
    });
    expect(
      sqlite
        .query(
          `
            select
              cursor,
              updated_at as updatedAt
            from sync_checkpoints
            where provider_connection_id = ?
          `,
        )
        .get("conn_simplefin_us_bank"),
    ).toEqual({
      cursor: "1742100000",
      updatedAt: new Date("2026-03-17T18:30:00.000Z").getTime(),
    });
  });
});
