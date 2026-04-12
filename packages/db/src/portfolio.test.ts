import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getDb } from "./client";
import { getPortfolioSnapshot } from "./portfolio";

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

  async raw<T>() {
    return this.database
      .query(this.query)
      .values(...(this.values as never[])) as T[];
  }

  async run() {
    this.database.query(this.query).run(...(this.values as never[]));
    return { success: true };
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

function createPortfolioTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  applyMigrations(sqlite);

  const createdAt = new Date("2026-03-15T12:00:00.000Z").getTime();
  const completedAt = new Date("2026-03-18T18:30:00.000Z").getTime();

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
    "acct_brokerage",
    "household_demo",
    "Taxable Brokerage",
    "Vanguard Taxable Brokerage",
    "brokerage",
    "investments",
    372012,
    createdAt,
    completedAt,
  );
  insertAccount.run(
    "acct_retirement",
    "household_demo",
    "Rollover IRA",
    "Vanguard",
    "retirement",
    "investments",
    121000,
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
      "sync_plaid_2026_03_18",
      "household_demo",
      "plaid",
      "succeeded",
      "scheduled",
      14,
      completedAt,
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
        asset_class,
        sub_asset_class,
        currency,
        created_at,
        updated_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );
  const insertSnapshot = sqlite.query(
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

  const holdings = [
    {
      accountId: "acct_brokerage",
      assetClass: "cash",
      costBasisMinor: 32012,
      holdingId: "holding_cash_brokerage",
      holdingKey: "cash:USD",
      marketValueMinor: 32012,
      name: "USD Cash",
      priceMinor: 100,
      quantity: "320.12",
      subAssetClass: "Brokerage cash",
      symbol: "USD",
    },
    {
      accountId: "acct_brokerage",
      assetClass: "equity",
      costBasisMinor: 250000,
      holdingId: "holding_vti",
      holdingKey: "symbol:vti",
      marketValueMinor: 300000,
      name: "Vanguard Total Stock Market ETF",
      priceMinor: 30000,
      quantity: "10",
      subAssetClass: "ETF",
      symbol: "VTI",
    },
    {
      accountId: "acct_brokerage",
      assetClass: "fixed_income",
      costBasisMinor: 38000,
      holdingId: "holding_bnd",
      holdingKey: "symbol:bnd",
      marketValueMinor: 40000,
      name: "Vanguard Total Bond Market ETF",
      priceMinor: 8000,
      quantity: "5",
      subAssetClass: "Bond ETF",
      symbol: "BND",
    },
    {
      accountId: "acct_retirement",
      assetClass: "cash",
      costBasisMinor: 21000,
      holdingId: "holding_cash_retirement",
      holdingKey: "cash:USD",
      marketValueMinor: 21000,
      name: "USD Cash",
      priceMinor: 100,
      quantity: "210",
      subAssetClass: "Retirement cash",
      symbol: "USD",
    },
    {
      accountId: "acct_retirement",
      assetClass: "equity",
      costBasisMinor: 90000,
      holdingId: "holding_vxus",
      holdingKey: "symbol:vxus",
      marketValueMinor: 100000,
      name: "Vanguard Total International Stock ETF",
      priceMinor: 5000,
      quantity: "20",
      subAssetClass: "ETF",
      symbol: "VXUS",
    },
  ] as const;

  for (const holding of holdings) {
    insertHolding.run(
      holding.holdingId,
      holding.accountId,
      holding.holdingKey,
      holding.symbol,
      holding.name,
      holding.assetClass,
      holding.subAssetClass,
      "USD",
      createdAt,
      completedAt,
    );

    insertSnapshot.run(
      `${holding.holdingId}_snapshot`,
      holding.holdingId,
      holding.accountId,
      "sync_plaid_2026_03_18",
      completedAt,
      "2026-03-18",
      holding.quantity,
      holding.priceMinor,
      holding.marketValueMinor,
      holding.costBasisMinor,
    );
  }

  return getDb(new FakeD1Database(sqlite) as unknown as D1Database);
}

describe("getPortfolioSnapshot", () => {
  test("throws when the household id is omitted", async () => {
    const db = createPortfolioTestDb();

    await expect(getPortfolioSnapshot(db, undefined as never)).rejects.toThrow(
      "Household id is required.",
    );
  });

  test("builds a portfolio view from the latest holding snapshots", async () => {
    const db = createPortfolioTestDb();

    const snapshot = await getPortfolioSnapshot(db, "household_demo");

    expect(snapshot).not.toBeNull();
    expect(snapshot?.householdName).toBe("Vista Household");
    expect(snapshot?.asOfDate).toBe("2026-03-18");
    expect(snapshot?.totals).toEqual({
      accountCount: 2,
      costBasisMinor: 431012,
      holdingCount: 5,
      marketValueMinor: 493012,
      unrealizedGainMinor: 62000,
    });
    expect(snapshot?.allocationBuckets).toEqual([
      {
        holdingCount: 2,
        key: "equity",
        label: "Equities",
        marketValueMinor: 400000,
      },
      {
        holdingCount: 2,
        key: "cash",
        label: "Cash",
        marketValueMinor: 53012,
      },
      {
        holdingCount: 1,
        key: "fixed_income",
        label: "Fixed income",
        marketValueMinor: 40000,
      },
    ]);
    expect(snapshot?.accounts.map((account) => account.name)).toEqual([
      "Taxable Brokerage",
      "Rollover IRA",
    ]);
    expect(snapshot?.topHoldings.slice(0, 3)).toEqual([
      {
        accountName: "Taxable Brokerage",
        assetClass: "equity",
        assetClassLabel: "Equities",
        holdingId: "holding_vti",
        marketValueMinor: 300000,
        name: "Vanguard Total Stock Market ETF",
        quantity: "10",
        symbol: "VTI",
      },
      {
        accountName: "Rollover IRA",
        assetClass: "equity",
        assetClassLabel: "Equities",
        holdingId: "holding_vxus",
        marketValueMinor: 100000,
        name: "Vanguard Total International Stock ETF",
        quantity: "20",
        symbol: "VXUS",
      },
      {
        accountName: "Taxable Brokerage",
        assetClass: "fixed_income",
        assetClassLabel: "Fixed income",
        holdingId: "holding_bnd",
        marketValueMinor: 40000,
        name: "Vanguard Total Bond Market ETF",
        quantity: "5",
        symbol: "BND",
      },
    ]);
  });
});
