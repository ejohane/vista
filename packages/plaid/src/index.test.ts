import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { syncPlaidConnection } from "./index";

class FakeD1PreparedStatement {
  constructor(
    private readonly database: Database,
    private readonly query: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new FakeD1PreparedStatement(this.database, this.query, values);
  }

  async all<T>() {
    return {
      results: this.database
        .query(this.query)
        .all(...(this.values as never[])) as T[],
    };
  }

  async first<T>() {
    const row = this.database
      .query(this.query)
      .get(...(this.values as never[]));

    return (row as T | undefined) ?? null;
  }

  async run() {
    const result = this.database
      .query(this.query)
      .run(...(this.values as never[]));

    return {
      meta: {
        changes: result.changes,
      },
      success: true,
    };
  }
}

class FakeD1Database {
  constructor(private readonly database: Database) {}

  async batch(statements: FakeD1PreparedStatement[]) {
    try {
      this.database.exec("BEGIN");

      const results = [];

      for (const statement of statements) {
        results.push(await statement.run());
      }

      this.database.exec("COMMIT");

      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  exec(query: string) {
    this.database.exec(query);
    return Promise.resolve();
  }

  prepare(query: string) {
    return new FakeD1PreparedStatement(this.database, query);
  }
}

function applyMigrations(database: Database) {
  const migrationsDir = fileURLToPath(
    new URL("../../db/migrations/", import.meta.url).toString(),
  );
  const migrationFiles = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  for (const fileName of migrationFiles) {
    database.exec(readFileSync(`${migrationsDir}/${fileName}`, "utf8"));
  }
}

function createPlaidTestDatabase() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  applyMigrations(sqlite);

  return {
    d1: new FakeD1Database(sqlite) as unknown as D1Database,
    sqlite,
  };
}

describe("syncPlaidConnection", () => {
  test("captures bank and investment transaction history and advances the Plaid cursor", async () => {
    const { d1, sqlite } = createPlaidTestDatabase();
    const createdAt = new Date("2026-03-27T23:00:00.000Z").getTime();

    sqlite
      .query(
        `
          insert into households (id, name, last_synced_at, created_at)
          values (?, ?, ?, ?)
        `,
      )
      .run("household_default", "Vista Household", createdAt, createdAt);
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
        "conn:plaid:item-history-1",
        "household_default",
        "plaid",
        "active",
        "item-history-1",
        "access-history-1",
        "Chase",
        "item-history-1",
        createdAt,
        createdAt,
      );

    let transactionsCursorSeen: null | string = null;
    let investmentWindowSeen: null | { endDate: string; startDate: string } =
      null;

    const result = await syncPlaidConnection({
      client: {
        createLinkToken: async () => {
          throw new Error("createLinkToken should not be called");
        },
        exchangePublicToken: async () => {
          throw new Error("exchangePublicToken should not be called");
        },
        getAccounts: async () => ({
          accounts: [
            {
              account_id: "depository-1",
              balances: {
                current: 2450.11,
                iso_currency_code: "USD",
              },
              name: "Everyday Checking",
              official_name: "Chase Everyday Checking",
              subtype: "checking",
              type: "depository",
            },
            {
              account_id: "investment-1",
              balances: {
                current: 12200.55,
                iso_currency_code: "USD",
              },
              name: "Brokerage",
              official_name: "Brokerage Account",
              subtype: "brokerage",
              type: "investment",
            },
          ],
          item: {
            institution_id: "ins_3",
            item_id: "item-history-1",
          },
        }),
        getInvestmentsHoldings: async () => ({
          accounts: [],
          holdings: [
            {
              account_id: "investment-1",
              cost_basis: 950,
              institution_price: 100,
              institution_price_as_of: "2026-03-27",
              institution_price_datetime: "2026-03-27T23:10:00.000Z",
              institution_value: 1000,
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
        getInvestmentsTransactions: async ({ endDate, startDate }) => {
          investmentWindowSeen = { endDate, startDate };

          return {
            investmentTransactions: [
              {
                account_id: "investment-1",
                amount: 250.25,
                date: "2026-03-20",
                fees: 1.25,
                investment_transaction_id: "invtxn-1",
                iso_currency_code: "USD",
                name: "BUY Vanguard Total Stock Market ETF",
                price: 250.25,
                quantity: 1,
                security_id: "security-vti",
                subtype: "buy",
                transaction_datetime: "2026-03-20T14:30:00.000Z",
                type: "buy",
              },
            ],
          };
        },
        getTransactionsSync: async ({ cursor }) => {
          transactionsCursorSeen = cursor ?? null;

          return {
            accounts: [],
            added: [
              {
                account_id: "depository-1",
                amount: 85.33,
                authorized_date: null,
                date: "2026-03-25",
                merchant_name: "Trader Joe's",
                name: "Trader Joe's",
                pending: false,
                personal_finance_category: {
                  detailed: "FOOD_AND_DRINK_GROCERIES",
                  primary: "FOOD_AND_DRINK",
                },
                transaction_id: "txn-1",
              },
            ],
            hasMore: false,
            modified: [],
            nextCursor: "cursor-1",
            removed: [],
          };
        },
      },
      connectionId: "conn:plaid:item-history-1",
      database: d1,
      now: new Date("2026-03-27T23:10:00.000Z"),
    });

    expect(result.status).toBe("succeeded");
    expect(transactionsCursorSeen).toBeNull();
    expect(
      investmentWindowSeen as null | {
        endDate: string;
        startDate: string;
      },
    ).toEqual({
      endDate: "2026-03-27",
      startDate: "2024-03-27",
    });
    expect(
      sqlite
        .query(
          `
            select
              provider_transaction_id as providerTransactionId,
              amount_minor as amountMinor,
              direction,
              description,
              merchant_name as merchantName,
              category_raw as categoryRaw
            from transactions
          `,
        )
        .get(),
    ).toEqual({
      amountMinor: 8533,
      categoryRaw: "FOOD_AND_DRINK_GROCERIES",
      description: "Trader Joe's",
      direction: "debit",
      merchantName: "Trader Joe's",
      providerTransactionId: "txn-1",
    });
    expect(
      sqlite
        .query(
          `
            select
              provider_transaction_id as providerTransactionId,
              amount_minor as amountMinor,
              fees_minor as feesMinor,
              price_minor as priceMinor,
              quantity,
              security_id as securityId,
              subtype,
              type
            from investment_transactions
          `,
        )
        .get(),
    ).toEqual({
      amountMinor: 25025,
      feesMinor: 125,
      priceMinor: 25025,
      providerTransactionId: "invtxn-1",
      quantity: "1",
      securityId: "security:plaid:security-vti",
      subtype: "buy",
      type: "buy",
    });
    expect(
      sqlite
        .query(
          `
            select
              id,
              provider as providerName,
              provider_security_id as providerSecurityId,
              symbol,
              name,
              price_source as priceSource
            from securities
          `,
        )
        .get(),
    ).toEqual({
      id: "security:plaid:security-vti",
      name: "Vanguard Total Stock Market ETF",
      priceSource: "alpha_vantage",
      providerName: "plaid",
      providerSecurityId: "security-vti",
      symbol: "VTI",
    });
    expect(
      sqlite
        .query(
          `
            select
              price_date as priceDate,
              close_price_minor as closePriceMinor,
              source
            from security_price_daily
            where security_id = ?
          `,
        )
        .get("security:plaid:security-vti"),
    ).toEqual({
      closePriceMinor: 10000,
      priceDate: "2026-03-27",
      source: "plaid_holdings",
    });
    expect(
      sqlite
        .query(
          `
            select cursor
            from sync_checkpoints
            where provider_connection_id = ?
          `,
        )
        .get("conn:plaid:item-history-1"),
    ).toEqual({ cursor: "cursor-1" });
  });

  test("upserts provider accounts and canonical accounts across repeated syncs", async () => {
    const { d1, sqlite } = createPlaidTestDatabase();
    const createdAt = new Date("2026-03-27T23:00:00.000Z").getTime();

    sqlite
      .query(
        `
          insert into households (id, name, last_synced_at, created_at)
          values (?, ?, ?, ?)
        `,
      )
      .run("household_default", "Vista Household", createdAt, createdAt);
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
        "conn:plaid:item-demo-1",
        "household_default",
        "plaid",
        "active",
        "item-demo-1",
        "access-demo-1",
        "Vanguard",
        "item-demo-1",
        createdAt,
        createdAt,
      );

    const client = {
      createLinkToken: async () => {
        throw new Error("createLinkToken should not be called");
      },
      exchangePublicToken: async () => {
        throw new Error("exchangePublicToken should not be called");
      },
      getInvestmentsHoldings: async () => ({
        accounts: [],
        holdings: [
          {
            account_id: "account-1",
            cost_basis: 900,
            institution_price: holdingsRequestCount === 0 ? 100 : 105,
            institution_price_as_of: "2026-03-27",
            institution_price_datetime:
              holdingsRequestCount === 0
                ? "2026-03-27T23:10:00.000Z"
                : "2026-03-27T23:20:00.000Z",
            institution_value: holdingsRequestCount === 0 ? 1000 : 1050,
            iso_currency_code: "USD",
            quantity: 10,
            security_id: "security-1",
          },
        ],
        securities: [
          {
            is_cash_equivalent: false,
            iso_currency_code: "USD",
            name: "Vanguard Total Stock Market ETF",
            security_id: "security-1",
            subtype: "etf",
            ticker_symbol: "VTI",
            type: "etf",
          },
        ],
      }),
      getAccounts: async () => ({
        accounts: [
          {
            account_id: "account-1",
            balances: {
              current: 1234.56,
              iso_currency_code: "USD",
            },
            name: "Brokerage Account",
            official_name: "Vanguard Brokerage Account",
            subtype: "brokerage",
            type: "investment",
          },
        ],
        item: {
          institution_id: "ins_109508",
          item_id: "item-demo-1",
        },
      }),
    };
    let holdingsRequestCount = 0;
    const originalGetInvestmentsHoldings = client.getInvestmentsHoldings;
    client.getInvestmentsHoldings = async () => {
      const result = await originalGetInvestmentsHoldings();
      holdingsRequestCount += 1;
      return result;
    };

    const firstResult = await syncPlaidConnection({
      client,
      connectionId: "conn:plaid:item-demo-1",
      database: d1,
      now: new Date("2026-03-27T23:10:00.000Z"),
    });
    const secondResult = await syncPlaidConnection({
      client,
      connectionId: "conn:plaid:item-demo-1",
      database: d1,
      now: new Date("2026-03-27T23:20:00.000Z"),
    });

    expect(firstResult.status).toBe("succeeded");
    expect(secondResult.status).toBe("succeeded");
    expect(
      sqlite.query("select count(*) as count from provider_accounts").get() as {
        count: number;
      },
    ).toEqual({ count: 1 });
    expect(
      sqlite.query("select count(*) as count from accounts").get() as {
        count: number;
      },
    ).toEqual({ count: 1 });
    expect(
      sqlite.query("select count(*) as count from balance_snapshots").get() as {
        count: number;
      },
    ).toEqual({ count: 2 });
    expect(
      sqlite.query("select count(*) as count from holdings").get() as {
        count: number;
      },
    ).toEqual({ count: 1 });
    expect(
      sqlite.query("select count(*) as count from holding_snapshots").get() as {
        count: number;
      },
    ).toEqual({ count: 2 });
    expect(
      sqlite
        .query(
          `
            select
              account_type as accountType,
              reporting_group as reportingGroup,
              balance_minor as balanceMinor,
              display_name as displayName,
              institution_name as institutionName
            from accounts
          `,
        )
        .get(),
    ).toEqual({
      accountType: "brokerage",
      balanceMinor: 123456,
      displayName: "Vanguard Brokerage Account",
      institutionName: "Vanguard",
      reportingGroup: "investments",
    });
    expect(
      sqlite
        .query(
          `
            select
              asset_class as assetClass,
              holding_key as holdingKey,
              name,
              security_id as securityId,
              sub_asset_class as subAssetClass,
              symbol
            from holdings
          `,
        )
        .get(),
    ).toEqual({
      assetClass: "fund",
      holdingKey: "security:security-1",
      name: "Vanguard Total Stock Market ETF",
      securityId: "security:plaid:security-1",
      subAssetClass: "etf:etf",
      symbol: "VTI",
    });
    expect(
      sqlite.query("select count(*) as count from securities").get(),
    ).toEqual({ count: 1 });
    expect(
      sqlite
        .query(
          `
            select
              market_value_minor as marketValueMinor,
              price_minor as priceMinor,
              quantity,
              source_sync_run_id as sourceSyncRunId
            from holding_snapshots
            order by captured_at desc
            limit 1
          `,
        )
        .get(),
    ).toEqual({
      marketValueMinor: 105000,
      priceMinor: 10500,
      quantity: "10",
      sourceSyncRunId: secondResult.runId,
    });
    expect(
      sqlite
        .query(
          `
            select count(*) as count
            from security_price_daily
            where security_id = ?
          `,
        )
        .get("security:plaid:security-1"),
    ).toEqual({ count: 1 });
  });
});
