import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { rebuildHistoricalNetWorthFacts } from "./historical-net-worth";

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

  async first<T>(columnName?: keyof T & string) {
    const row = this.database
      .query(this.query)
      .get(...(this.values as never[])) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    if (columnName) {
      return (row[columnName] as T[keyof T]) ?? null;
    }

    return row as T;
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
    new URL("../migrations/", import.meta.url).toString(),
  );
  const migrationFiles = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  for (const fileName of migrationFiles) {
    database.exec(readFileSync(`${migrationsDir}/${fileName}`, "utf8"));
  }
}

function createHistoricalNetWorthTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  applyMigrations(sqlite);

  return {
    d1: new FakeD1Database(sqlite) as unknown as D1Database,
    sqlite,
  };
}

describe("rebuildHistoricalNetWorthFacts", () => {
  test("skips leading dates with no priced positions instead of emitting zero net-worth facts", async () => {
    const { d1, sqlite } = createHistoricalNetWorthTestDb();
    const createdAt = Date.parse("2026-04-01T00:00:00.000Z");
    const completedAt = Date.parse("2026-04-10T18:30:00.000Z");

    sqlite
      .query(
        `
          insert into households (id, name, last_synced_at, created_at)
          values (?, ?, ?, ?)
        `,
      )
      .run("household_demo", "Vista Household", completedAt, createdAt);
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
        "acct_brokerage",
        "household_demo",
        "Taxable Brokerage",
        "Vanguard",
        "brokerage",
        "investments",
        276110,
        createdAt,
        completedAt,
      );
    sqlite
      .query(
        `
          insert into sync_runs (
            id,
            household_id,
            provider,
            status,
            trigger,
            records_changed,
            started_at,
            completed_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "sync_plaid_2026_04_10",
        "household_demo",
        "plaid",
        "succeeded",
        "scheduled",
        12,
        completedAt,
        completedAt,
      );
    sqlite
      .query(
        `
          insert into securities (
            id,
            provider,
            provider_security_id,
            symbol,
            name,
            security_type,
            security_subtype,
            currency,
            price_source,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "security:plaid:security-vti",
        "plaid",
        "security-vti",
        "VTI",
        "Vanguard Total Stock Market ETF",
        "etf",
        "large_cap",
        "USD",
        "alpha_vantage",
        createdAt,
        completedAt,
      );
    sqlite
      .query(
        `
          insert into holdings (
            id,
            account_id,
            holding_key,
            symbol,
            name,
            security_id,
            asset_class,
            sub_asset_class,
            currency,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "holding_vti",
        "acct_brokerage",
        "security:security-vti",
        "VTI",
        "Vanguard Total Stock Market ETF",
        "security:plaid:security-vti",
        "fund",
        "etf",
        "USD",
        createdAt,
        completedAt,
      );
    sqlite
      .query(
        `
          insert into holding_snapshots (
            id,
            holding_id,
            account_id,
            source_sync_run_id,
            captured_at,
            as_of_date,
            quantity,
            price_minor,
            market_value_minor,
            cost_basis_minor
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "holding_snapshot_vti_2026_04_10",
        "holding_vti",
        "acct_brokerage",
        "sync_plaid_2026_04_10",
        completedAt,
        "2026-04-10",
        "10",
        27611,
        276110,
        250000,
      );
    sqlite
      .query(
        `
          insert into investment_transactions (
            id,
            account_id,
            provider_transaction_id,
            posted_at,
            trade_at,
            amount_minor,
            price_minor,
            fees_minor,
            quantity,
            name,
            security_id,
            type,
            subtype,
            currency,
            source_sync_run_id
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "invtxn_2026_04_08_buy",
        "acct_brokerage",
        "provider-invtxn-buy",
        Date.parse("2026-04-08T15:00:00.000Z"),
        Date.parse("2026-04-08T15:00:00.000Z"),
        54864,
        27432,
        null,
        "2",
        "BUY Vanguard Total Stock Market ETF",
        "security:plaid:security-vti",
        "buy",
        "buy",
        "USD",
        "sync_plaid_2026_04_10",
      );
    sqlite
      .query(
        `
          insert into security_price_daily (
            security_id,
            price_date,
            close_price_minor,
            currency,
            source,
            is_estimated,
            fetched_at
          )
          values (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "security:plaid:security-vti",
        "2026-04-10",
        27611,
        "USD",
        "plaid_holdings",
        0,
        completedAt,
      );

    const result = await rebuildHistoricalNetWorthFacts({
      database: d1,
      endDate: "2026-04-10",
      householdId: "household_demo",
      now: new Date("2026-04-11T00:00:00.000Z"),
      startDate: "2026-04-08",
    });

    expect(result).toEqual({
      accountValueFactCount: 3,
      netWorthFactCount: 1,
      positionFactCount: 3,
    });
    expect(
      sqlite
        .query(
          `
            select fact_date as factDate, net_worth_minor as netWorthMinor
            from daily_net_worth_facts
            order by fact_date asc
          `,
        )
        .all(),
    ).toEqual([
      {
        factDate: "2026-04-10",
        netWorthMinor: 276110,
      },
    ]);
  });

  test("skips dates where an investment account is entirely unpriced to avoid partial-household spikes", async () => {
    const { d1, sqlite } = createHistoricalNetWorthTestDb();
    const createdAt = Date.parse("2026-04-01T00:00:00.000Z");
    const completedAt = Date.parse("2026-04-11T18:30:00.000Z");

    sqlite
      .query(
        `
          insert into households (id, name, last_synced_at, created_at)
          values (?, ?, ?, ?)
        `,
      )
      .run("household_demo", "Vista Household", completedAt, createdAt);

    const insertAccount = sqlite.query(
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
    );
    insertAccount.run(
      "acct_a",
      "household_demo",
      "Account A",
      "Vanguard",
      "brokerage",
      "investments",
      100000,
      createdAt,
      completedAt,
    );
    insertAccount.run(
      "acct_b",
      "household_demo",
      "Account B",
      "Vanguard",
      "brokerage",
      "investments",
      200000,
      createdAt,
      completedAt,
    );

    sqlite
      .query(
        `
          insert into sync_runs (
            id,
            household_id,
            provider,
            status,
            trigger,
            records_changed,
            started_at,
            completed_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "sync_plaid_2026_04_11",
        "household_demo",
        "plaid",
        "succeeded",
        "scheduled",
        12,
        completedAt,
        completedAt,
      );

    const insertSecurity = sqlite.query(
      `
        insert into securities (
          id,
          provider,
          provider_security_id,
          symbol,
          name,
          security_type,
          security_subtype,
          currency,
          price_source,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    insertSecurity.run(
      "security:plaid:security-a",
      "plaid",
      "security-a",
      "AAA",
      "Security A",
      "etf",
      "large_cap",
      "USD",
      "alpha_vantage",
      createdAt,
      completedAt,
    );
    insertSecurity.run(
      "security:plaid:security-b",
      "plaid",
      "security-b",
      "BBB",
      "Security B",
      "etf",
      "large_cap",
      "USD",
      "alpha_vantage",
      createdAt,
      completedAt,
    );

    const insertHolding = sqlite.query(
      `
        insert into holdings (
          id,
          account_id,
          holding_key,
          symbol,
          name,
          security_id,
          asset_class,
          sub_asset_class,
          currency,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    insertHolding.run(
      "holding_a",
      "acct_a",
      "security:security-a",
      "AAA",
      "Security A",
      "security:plaid:security-a",
      "fund",
      "etf",
      "USD",
      createdAt,
      completedAt,
    );
    insertHolding.run(
      "holding_b",
      "acct_b",
      "security:security-b",
      "BBB",
      "Security B",
      "security:plaid:security-b",
      "fund",
      "etf",
      "USD",
      createdAt,
      completedAt,
    );

    const insertHoldingSnapshot = sqlite.query(
      `
        insert into holding_snapshots (
          id,
          holding_id,
          account_id,
          source_sync_run_id,
          captured_at,
          as_of_date,
          quantity,
          price_minor,
          market_value_minor,
          cost_basis_minor
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    insertHoldingSnapshot.run(
      "holding_snapshot_a_2026_04_11",
      "holding_a",
      "acct_a",
      "sync_plaid_2026_04_11",
      completedAt,
      "2026-04-11",
      "10",
      10000,
      100000,
      90000,
    );
    insertHoldingSnapshot.run(
      "holding_snapshot_b_2026_04_11",
      "holding_b",
      "acct_b",
      "sync_plaid_2026_04_11",
      completedAt,
      "2026-04-11",
      "10",
      20000,
      200000,
      180000,
    );

    const insertPrice = sqlite.query(
      `
        insert into security_price_daily (
          security_id,
          price_date,
          close_price_minor,
          currency,
          source,
          is_estimated,
          fetched_at
        )
        values (?, ?, ?, ?, ?, ?, ?)
      `,
    );
    insertPrice.run(
      "security:plaid:security-a",
      "2026-04-10",
      10000,
      "USD",
      "alpha_vantage",
      0,
      completedAt,
    );
    insertPrice.run(
      "security:plaid:security-a",
      "2026-04-11",
      10000,
      "USD",
      "alpha_vantage",
      0,
      completedAt,
    );
    insertPrice.run(
      "security:plaid:security-b",
      "2026-04-11",
      20000,
      "USD",
      "alpha_vantage",
      0,
      completedAt,
    );

    const result = await rebuildHistoricalNetWorthFacts({
      database: d1,
      endDate: "2026-04-11",
      householdId: "household_demo",
      now: new Date("2026-04-12T00:00:00.000Z"),
      startDate: "2026-04-10",
    });

    expect(result.netWorthFactCount).toBe(1);
    expect(
      sqlite
        .query(
          `
            select fact_date as factDate, net_worth_minor as netWorthMinor
            from daily_net_worth_facts
            order by fact_date asc
          `,
        )
        .all(),
    ).toEqual([
      {
        factDate: "2026-04-11",
        netWorthMinor: 300000,
      },
    ]);
  });

  test("rebuilds daily positions, valuations, and mixed-coverage net-worth facts idempotently", async () => {
    const { d1, sqlite } = createHistoricalNetWorthTestDb();
    const createdAt = Date.parse("2026-04-01T00:00:00.000Z");
    const completedAt = Date.parse("2026-04-10T18:30:00.000Z");

    sqlite
      .query(
        `
          insert into households (id, name, last_synced_at, created_at)
          values (?, ?, ?, ?)
        `,
      )
      .run("household_demo", "Vista Household", completedAt, createdAt);

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
        "acct_brokerage",
        "household_demo",
        "Taxable Brokerage",
        "Vanguard",
        "brokerage",
        "investments",
        276110,
        createdAt,
        completedAt,
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
        "acct_checking",
        "household_demo",
        "Everyday Checking",
        "US Bank",
        "checking",
        "cash",
        52000,
        createdAt,
        completedAt,
      );

    sqlite
      .query(
        `
          insert into sync_runs (
            id,
            household_id,
            provider,
            status,
            trigger,
            records_changed,
            started_at,
            completed_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "sync_plaid_2026_04_08",
        "household_demo",
        "plaid",
        "succeeded",
        "scheduled",
        8,
        Date.parse("2026-04-08T18:30:00.000Z"),
        Date.parse("2026-04-08T18:30:00.000Z"),
      );
    sqlite
      .query(
        `
          insert into sync_runs (
            id,
            household_id,
            provider,
            status,
            trigger,
            records_changed,
            started_at,
            completed_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "sync_plaid_2026_04_10",
        "household_demo",
        "plaid",
        "succeeded",
        "scheduled",
        12,
        completedAt,
        completedAt,
      );

    sqlite
      .query(
        `
          insert into securities (
            id,
            provider,
            provider_security_id,
            symbol,
            name,
            security_type,
            security_subtype,
            currency,
            price_source,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "security:plaid:security-vti",
        "plaid",
        "security-vti",
        "VTI",
        "Vanguard Total Stock Market ETF",
        "etf",
        "large_cap",
        "USD",
        "alpha_vantage",
        createdAt,
        completedAt,
      );

    sqlite
      .query(
        `
          insert into holdings (
            id,
            account_id,
            holding_key,
            symbol,
            name,
            security_id,
            asset_class,
            sub_asset_class,
            currency,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "holding_vti",
        "acct_brokerage",
        "security:security-vti",
        "VTI",
        "Vanguard Total Stock Market ETF",
        "security:plaid:security-vti",
        "fund",
        "etf",
        "USD",
        createdAt,
        completedAt,
      );
    sqlite
      .query(
        `
          insert into holding_snapshots (
            id,
            holding_id,
            account_id,
            source_sync_run_id,
            captured_at,
            as_of_date,
            quantity,
            price_minor,
            market_value_minor,
            cost_basis_minor
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "holding_snapshot_vti_2026_04_10",
        "holding_vti",
        "acct_brokerage",
        "sync_plaid_2026_04_10",
        completedAt,
        "2026-04-10",
        "10",
        27611,
        276110,
        250000,
      );

    const insertInvestmentTransaction = sqlite.query(
      `
        insert into investment_transactions (
          id,
          account_id,
          provider_transaction_id,
          posted_at,
          trade_at,
          amount_minor,
          price_minor,
          fees_minor,
          quantity,
          name,
          security_id,
          type,
          subtype,
          currency,
          source_sync_run_id
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    insertInvestmentTransaction.run(
      "invtxn_2026_04_10_sell",
      "acct_brokerage",
      "provider-invtxn-sell",
      Date.parse("2026-04-10T15:00:00.000Z"),
      Date.parse("2026-04-10T15:00:00.000Z"),
      27611,
      27611,
      null,
      "1",
      "SELL Vanguard Total Stock Market ETF",
      "security:plaid:security-vti",
      "sell",
      "sell",
      "USD",
      "sync_plaid_2026_04_10",
    );
    insertInvestmentTransaction.run(
      "invtxn_2026_04_09_fee",
      "acct_brokerage",
      "provider-invtxn-fee",
      Date.parse("2026-04-09T15:00:00.000Z"),
      Date.parse("2026-04-09T15:00:00.000Z"),
      200,
      null,
      200,
      "0",
      "Account Fee",
      "security:plaid:security-vti",
      "fee",
      "fee",
      "USD",
      "sync_plaid_2026_04_10",
    );
    insertInvestmentTransaction.run(
      "invtxn_2026_04_08_buy",
      "acct_brokerage",
      "provider-invtxn-buy",
      Date.parse("2026-04-08T15:00:00.000Z"),
      Date.parse("2026-04-08T15:00:00.000Z"),
      54864,
      27432,
      null,
      "2",
      "BUY Vanguard Total Stock Market ETF",
      "security:plaid:security-vti",
      "buy",
      "buy",
      "USD",
      "sync_plaid_2026_04_10",
    );
    insertInvestmentTransaction.run(
      "invtxn_2026_04_07_reinvest",
      "acct_brokerage",
      "provider-invtxn-reinvest",
      Date.parse("2026-04-07T15:00:00.000Z"),
      Date.parse("2026-04-07T15:00:00.000Z"),
      13450,
      26900,
      null,
      "0.5",
      "REINVEST DIVIDEND Vanguard Total Stock Market ETF",
      "security:plaid:security-vti",
      "buy",
      "reinvest dividend",
      "USD",
      "sync_plaid_2026_04_10",
    );

    const insertBalanceSnapshot = sqlite.query(
      `
        insert into balance_snapshots (
          id,
          account_id,
          source_sync_run_id,
          captured_at,
          as_of_date,
          balance_minor
        )
        values (?, ?, ?, ?, ?, ?)
      `,
    );
    insertBalanceSnapshot.run(
      "snapshot_cash_2026_04_08",
      "acct_checking",
      "sync_plaid_2026_04_08",
      Date.parse("2026-04-08T18:30:00.000Z"),
      "2026-04-08",
      50000,
    );
    insertBalanceSnapshot.run(
      "snapshot_cash_2026_04_10",
      "acct_checking",
      "sync_plaid_2026_04_10",
      Date.parse("2026-04-10T18:30:00.000Z"),
      "2026-04-10",
      52000,
    );

    const insertPrice = sqlite.query(
      `
        insert into security_price_daily (
          security_id,
          price_date,
          close_price_minor,
          currency,
          source,
          is_estimated,
          fetched_at
        )
        values (?, ?, ?, ?, ?, ?, ?)
      `,
    );
    insertPrice.run(
      "security:plaid:security-vti",
      "2026-04-06",
      26800,
      "USD",
      "alpha_vantage",
      0,
      completedAt,
    );
    insertPrice.run(
      "security:plaid:security-vti",
      "2026-04-07",
      26900,
      "USD",
      "alpha_vantage",
      0,
      completedAt,
    );
    insertPrice.run(
      "security:plaid:security-vti",
      "2026-04-08",
      27432,
      "USD",
      "alpha_vantage",
      0,
      completedAt,
    );
    insertPrice.run(
      "security:plaid:security-vti",
      "2026-04-09",
      null,
      "USD",
      "missing",
      1,
      completedAt,
    );
    insertPrice.run(
      "security:plaid:security-vti",
      "2026-04-10",
      27611,
      "USD",
      "plaid_holdings",
      0,
      completedAt,
    );

    const firstResult = await rebuildHistoricalNetWorthFacts({
      database: d1,
      endDate: "2026-04-10",
      householdId: "household_demo",
      now: new Date("2026-04-11T00:00:00.000Z"),
      startDate: "2026-04-06",
    });
    const secondResult = await rebuildHistoricalNetWorthFacts({
      database: d1,
      endDate: "2026-04-10",
      householdId: "household_demo",
      now: new Date("2026-04-11T00:05:00.000Z"),
      startDate: "2026-04-06",
    });

    expect(firstResult).toEqual({
      accountValueFactCount: 5,
      netWorthFactCount: 5,
      positionFactCount: 5,
    });
    expect(secondResult).toEqual({
      accountValueFactCount: 5,
      netWorthFactCount: 5,
      positionFactCount: 5,
    });
    expect(
      sqlite
        .query(
          `
            select
              position_date as positionDate,
              quantity
            from daily_security_position_facts
            order by position_date asc
          `,
        )
        .all(),
    ).toEqual([
      { positionDate: "2026-04-06", quantity: "8.5" },
      { positionDate: "2026-04-07", quantity: "9" },
      { positionDate: "2026-04-08", quantity: "11" },
      { positionDate: "2026-04-09", quantity: "11" },
      { positionDate: "2026-04-10", quantity: "10" },
    ]);
    expect(
      sqlite
        .query(
          `
            select
              fact_date as factDate,
              market_value_minor as marketValueMinor,
              missing_price_count as missingPriceCount,
              priced_position_count as pricedPositionCount,
              is_estimated as isEstimated
            from daily_investment_account_value_facts
            where fact_date in ('2026-04-09', '2026-04-10')
            order by fact_date asc
          `,
        )
        .all(),
    ).toEqual([
      {
        factDate: "2026-04-09",
        isEstimated: 1,
        marketValueMinor: 301752,
        missingPriceCount: 0,
        pricedPositionCount: 1,
      },
      {
        factDate: "2026-04-10",
        isEstimated: 0,
        marketValueMinor: 276110,
        missingPriceCount: 0,
        pricedPositionCount: 1,
      },
    ]);
    expect(
      sqlite
        .query(
          `
            select
              fact_date as factDate,
              cash_minor as cashMinor,
              investments_minor as investmentsMinor,
              liabilities_minor as liabilitiesMinor,
              net_worth_minor as netWorthMinor,
              coverage_mode as coverageMode,
              is_estimated as isEstimated
            from daily_net_worth_facts
            where fact_date in ('2026-04-09', '2026-04-10')
            order by fact_date asc
          `,
        )
        .all(),
    ).toEqual([
      {
        cashMinor: 50000,
        coverageMode: "mixed_snapshot_and_backfill",
        factDate: "2026-04-09",
        investmentsMinor: 301752,
        isEstimated: 1,
        liabilitiesMinor: 0,
        netWorthMinor: 351752,
      },
      {
        cashMinor: 52000,
        coverageMode: "mixed_snapshot_and_backfill",
        factDate: "2026-04-10",
        investmentsMinor: 276110,
        isEstimated: 0,
        liabilitiesMinor: 0,
        netWorthMinor: 328110,
      },
    ]);
    expect(
      sqlite
        .query(
          "select count(*) as count from daily_net_worth_facts where household_id = ?",
        )
        .get("household_demo"),
    ).toEqual({ count: 5 });
  });
});
