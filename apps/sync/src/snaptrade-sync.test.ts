import { describe, expect, mock, test } from "bun:test";

import { syncSnaptradeConnection } from "./snaptrade-sync";
import { createEmptySyncDatabase } from "./test-helpers";

const now = new Date("2026-03-18T18:30:00.000Z");

function seedSnaptradeConnection(
  sqlite: ReturnType<typeof createEmptySyncDatabase>["sqlite"],
) {
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
          access_secret,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      "conn_snaptrade_vanguard",
      "household_demo",
      "snaptrade",
      "active",
      "brokerage-auth-1",
      "snaptrade-user-secret",
      createdAt,
      createdAt,
    );
}

describe("syncSnaptradeConnection", () => {
  test("writes SnapTrade accounts, balances, holdings, and a checkpoint", async () => {
    const { d1, sqlite } = createEmptySyncDatabase();
    seedSnaptradeConnection(sqlite);

    const listUserAccounts = mock(async (args: Record<string, string>) => {
      expect(args).toEqual({
        brokerageAuthorizationId: "brokerage-auth-1",
        userId: "household_demo",
        userSecret: "snaptrade-user-secret",
      });

      return [
        {
          balance: {
            total: {
              amount: 3720.12,
              currency: "USD",
            },
          },
          brokerage_authorization: "brokerage-auth-1",
          id: "snaptrade-account-brokerage",
          institution_name: "Vanguard",
          is_paper: false,
          name: "Vanguard Taxable Brokerage",
          raw_type: "Individual",
        },
        {
          balance: {
            total: {
              amount: 3460,
              currency: "USD",
            },
          },
          brokerage_authorization: "brokerage-auth-1",
          id: "snaptrade-account-retirement",
          institution_name: "Vanguard",
          is_paper: false,
          name: "Vanguard Rollover IRA",
          raw_type: "IRA",
        },
      ];
    });
    const getAllUserHoldings = mock(async (args: Record<string, string>) => {
      expect(args).toEqual({
        brokerageAuthorizationId: "brokerage-auth-1",
        userId: "household_demo",
        userSecret: "snaptrade-user-secret",
      });

      return [
        {
          account: {
            id: "snaptrade-account-brokerage",
            institution_name: "Vanguard",
            name: "Vanguard Taxable Brokerage",
          },
          balances: [
            {
              cash: 320.12,
              currency: {
                code: "USD",
              },
            },
          ],
          positions: [
            {
              average_purchase_price: 250,
              cash_equivalent: false,
              price: 300,
              symbol: {
                symbol: {
                  description: "Vanguard Total Stock Market ETF",
                  id: "universal-vti",
                  raw_symbol: "VTI",
                  symbol: "VTI",
                  type: {
                    code: "et",
                    description: "ETF",
                  },
                },
              },
              units: 10,
            },
            {
              average_purchase_price: 76,
              cash_equivalent: false,
              price: 80,
              symbol: {
                symbol: {
                  description: "Vanguard Total Bond Market ETF",
                  id: "universal-bnd",
                  raw_symbol: "BND",
                  symbol: "BND",
                  type: {
                    code: "bnd",
                    description: "Bond ETF",
                  },
                },
              },
              units: 5,
            },
          ],
        },
        {
          account: {
            id: "snaptrade-account-retirement",
            institution_name: "Vanguard",
            name: "Vanguard Rollover IRA",
          },
          balances: [
            {
              cash: 210,
              currency: {
                code: "USD",
              },
            },
          ],
          positions: [
            {
              average_purchase_price: 45,
              cash_equivalent: false,
              price: 50,
              symbol: {
                symbol: {
                  description: "Vanguard Total International Stock ETF",
                  id: "universal-vxus",
                  raw_symbol: "VXUS",
                  symbol: "VXUS",
                  type: {
                    code: "et",
                    description: "ETF",
                  },
                },
              },
              units: 20,
            },
          ],
        },
      ];
    });

    const result = await syncSnaptradeConnection({
      client: {
        getAllUserHoldings,
        listUserAccounts,
      },
      connectionId: "conn_snaptrade_vanguard",
      database: d1,
      now,
    });

    expect(result.status).toBe("succeeded");
    expect(listUserAccounts).toHaveBeenCalledTimes(1);
    expect(getAllUserHoldings).toHaveBeenCalledTimes(1);
    expect(
      sqlite
        .query(
          `
            select count(*) as count
            from provider_accounts
            where provider_connection_id = ?
          `,
        )
        .get("conn_snaptrade_vanguard"),
    ).toEqual({ count: 2 });
    expect(
      sqlite
        .query(
          `
            select
              id,
              account_type as accountType,
              balance_minor as balanceMinor
            from accounts
            order by id
          `,
        )
        .all(),
    ).toEqual([
      {
        accountType: "brokerage",
        balanceMinor: 372012,
        id: "acct:snaptrade:conn_snaptrade_vanguard:snaptrade-account-brokerage",
      },
      {
        accountType: "retirement",
        balanceMinor: 346000,
        id: "acct:snaptrade:conn_snaptrade_vanguard:snaptrade-account-retirement",
      },
    ]);
    expect(
      sqlite.query("select count(*) as count from holdings").get(),
    ).toEqual({ count: 5 });
    expect(
      sqlite.query("select count(*) as count from holding_snapshots").get(),
    ).toEqual({ count: 5 });
    expect(
      sqlite
        .query(
          `
            select
              holdings.asset_class as assetClass,
              holdings.symbol as symbol,
              holding_snapshots.market_value_minor as marketValueMinor
            from holding_snapshots
            inner join holdings on holdings.id = holding_snapshots.holding_id
            order by holding_snapshots.market_value_minor desc
            limit 3
          `,
        )
        .all(),
    ).toEqual([
      {
        assetClass: "equity",
        marketValueMinor: 300000,
        symbol: "VTI",
      },
      {
        assetClass: "equity",
        marketValueMinor: 100000,
        symbol: "VXUS",
      },
      {
        assetClass: "fixed_income",
        marketValueMinor: 40000,
        symbol: "BND",
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
      cursor: "2026-03-18T18:30:00.000Z",
      providerConnectionId: "conn_snaptrade_vanguard",
    });

    const syncRun = sqlite
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
      .get(result.runId) as {
      provider: string;
      providerConnectionId: string;
      recordsChanged: number;
      status: string;
    };

    expect(syncRun.provider).toBe("snaptrade");
    expect(syncRun.providerConnectionId).toBe("conn_snaptrade_vanguard");
    expect(syncRun.recordsChanged).toBeGreaterThan(0);
    expect(syncRun.status).toBe("succeeded");
  });
});
