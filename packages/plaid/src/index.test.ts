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
  });
});
