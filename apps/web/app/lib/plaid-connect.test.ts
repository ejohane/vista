import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  createPlaidLinkToken,
  exchangePlaidPublicToken,
} from "./plaid-connect";

class FakeD1PreparedStatement {
  constructor(
    private readonly database: Database,
    private readonly query: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new FakeD1PreparedStatement(this.database, this.query, values);
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
    new URL("../../../../packages/db/migrations/", import.meta.url).toString(),
  );
  const migrationFiles = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  for (const fileName of migrationFiles) {
    database.exec(readFileSync(`${migrationsDir}/${fileName}`, "utf8"));
  }
}

function createWebTestDatabase() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  applyMigrations(sqlite);

  return {
    d1: new FakeD1Database(sqlite) as unknown as D1Database,
    sqlite,
  };
}

describe("exchangePlaidPublicToken", () => {
  test("creates a link token with investment-only products", async () => {
    const { d1 } = createWebTestDatabase();
    const createLinkTokenCalls: Array<Record<string, unknown>> = [];

    const result = await createPlaidLinkToken({
      createHouseholdId: () => "household_generated",
      client: {
        createLinkToken: async (args) => {
          createLinkTokenCalls.push(args as Record<string, unknown>);

          return {
            expiration: "2026-03-27T00:00:00.000Z",
            linkToken: "link-sandbox-456",
          };
        },
        exchangePublicToken: async () => {
          throw new Error("exchangePublicToken should not be called");
        },
        getAccounts: async () => {
          throw new Error("getAccounts should not be called");
        },
        getInvestmentsHoldings: async () => {
          throw new Error("getInvestmentsHoldings should not be called");
        },
      },
      database: d1,
      now: new Date("2026-03-26T21:00:00.000Z"),
    });

    expect(result).toEqual({
      householdId: "household_generated",
      householdWasCreated: true,
      linkToken: "link-sandbox-456",
    });
    expect(createLinkTokenCalls).toEqual([
      {
        countryCodes: undefined,
        products: ["investments"],
        redirectUri: undefined,
        userId: "household_generated",
      },
    ]);
  });

  test("throws when multiple households exist and no target household was provided", async () => {
    const { d1, sqlite } = createWebTestDatabase();
    const createdAt = new Date("2026-03-26T21:00:00.000Z").getTime();

    sqlite
      .query(
        `
          insert into households (id, name, last_synced_at, created_at)
          values (?, ?, ?, ?), (?, ?, ?, ?)
        `,
      )
      .run(
        "household_alpha",
        "Alpha Household",
        createdAt,
        createdAt,
        "household_beta",
        "Beta Household",
        createdAt,
        createdAt,
      );

    await expect(
      createPlaidLinkToken({
        client: {
          createLinkToken: async () => {
            throw new Error("createLinkToken should not be called");
          },
          exchangePublicToken: async () => {
            throw new Error("exchangePublicToken should not be called");
          },
          getAccounts: async () => {
            throw new Error("getAccounts should not be called");
          },
          getInvestmentsHoldings: async () => {
            throw new Error("getInvestmentsHoldings should not be called");
          },
        },
        database: d1,
      }),
    ).rejects.toThrow(
      "Multiple households are available. Pass householdId explicitly.",
    );
  });

  test("exchanges the public token, creates a household, and stores the Plaid connection", async () => {
    const { d1, sqlite } = createWebTestDatabase();

    const result = await exchangePlaidPublicToken({
      createHouseholdId: () => "household_generated",
      client: {
        createLinkToken: async () => {
          throw new Error("createLinkToken should not be called");
        },
        exchangePublicToken: async () => ({
          accessToken: "access-sandbox-123",
          itemId: "item-sandbox-123",
        }),
        getAccounts: async () => {
          throw new Error("getAccounts should not be called");
        },
        getInvestmentsHoldings: async () => {
          throw new Error("getInvestmentsHoldings should not be called");
        },
      },
      database: d1,
      institutionId: "ins_109508",
      institutionName: "Vanguard",
      now: new Date("2026-03-26T21:00:00.000Z"),
      publicToken: "public-sandbox-123",
    });

    expect(result).toEqual({
      connectionId: "conn:plaid:item-sandbox-123",
      householdId: "household_generated",
      householdWasCreated: true,
    });
    expect(
      sqlite
        .query(
          `
            select
              provider,
              external_connection_id as externalConnectionId,
              access_token as accessToken,
              institution_id as institutionId,
              institution_name as institutionName,
              plaid_item_id as plaidItemId,
              status
            from provider_connections
          `,
        )
        .get(),
    ).toEqual({
      accessToken: "access-sandbox-123",
      externalConnectionId: "item-sandbox-123",
      institutionId: "ins_109508",
      institutionName: "Vanguard",
      plaidItemId: "item-sandbox-123",
      provider: "plaid",
      status: "active",
    });
  });

  test("can keep the access token out of shared D1 while forwarding the full connection to household state", async () => {
    const { d1, sqlite } = createWebTestDatabase();
    const persistedConnections: Array<Record<string, unknown>> = [];

    const result = await exchangePlaidPublicToken({
      createHouseholdId: () => "household_generated",
      client: {
        createLinkToken: async () => {
          throw new Error("createLinkToken should not be called");
        },
        exchangePublicToken: async () => ({
          accessToken: "access-sandbox-state-123",
          itemId: "item-sandbox-state-123",
        }),
        getAccounts: async () => {
          throw new Error("getAccounts should not be called");
        },
        getInvestmentsHoldings: async () => {
          throw new Error("getInvestmentsHoldings should not be called");
        },
      },
      database: d1,
      institutionId: "ins_109508",
      institutionName: "Vanguard",
      now: new Date("2026-03-26T21:00:00.000Z"),
      onConnectionPersisted: async (connection) => {
        persistedConnections.push(connection as Record<string, unknown>);
      },
      persistAccessTokenInDatabase: false,
      publicToken: "public-sandbox-123",
    });

    expect(result).toEqual({
      connectionId: "conn:plaid:item-sandbox-state-123",
      householdId: "household_generated",
      householdWasCreated: true,
    });
    expect(
      sqlite
        .query(
          `
            select access_token as accessToken
            from provider_connections
          `,
        )
        .get(),
    ).toEqual({
      accessToken: null,
    });
    expect(persistedConnections).toEqual([
      {
        accessToken: "access-sandbox-state-123",
        connectionId: "conn:plaid:item-sandbox-state-123",
        createdAt: new Date("2026-03-26T21:00:00.000Z"),
        externalConnectionId: "item-sandbox-state-123",
        householdId: "household_generated",
        institutionId: "ins_109508",
        institutionName: "Vanguard",
        plaidItemId: "item-sandbox-state-123",
        updatedAt: new Date("2026-03-26T21:00:00.000Z"),
      },
    ]);
  });
});
