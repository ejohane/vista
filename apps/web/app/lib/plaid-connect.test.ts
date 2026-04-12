import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  createPlaidLinkToken,
  exchangePlaidPublicToken,
} from "./plaid-connect";

const TEST_ENCRYPTION_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

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
      householdId: "household_viewer",
      now: new Date("2026-03-26T21:00:00.000Z"),
    });

    expect(result).toEqual({
      householdId: "household_viewer",
      householdWasCreated: false,
      linkToken: "link-sandbox-456",
    });
    expect(createLinkTokenCalls).toEqual([
      {
        countryCodes: undefined,
        products: ["investments"],
        redirectUri: undefined,
        userId: "household_viewer",
      },
    ]);
  });

  test("exchanges the public token for the authenticated household and stores the Plaid connection", async () => {
    const { d1, sqlite } = createWebTestDatabase();
    const now = new Date("2026-03-26T21:00:00.000Z");

    sqlite
      .query(
        `
          insert into households (id, name, last_synced_at, created_at)
          values (?, ?, ?, ?)
        `,
      )
      .run("household_viewer", "My Household", now.getTime(), now.getTime());

    const result = await exchangePlaidPublicToken({
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
      householdId: "household_viewer",
      institutionId: "ins_109508",
      institutionName: "Vanguard",
      now,
      providerTokenEncryptionKey: TEST_ENCRYPTION_KEY,
      publicToken: "public-sandbox-123",
    });

    expect(result).toEqual({
      connectionId: "conn:plaid:item-sandbox-123",
      householdId: "household_viewer",
      householdWasCreated: false,
    });
    expect(
      sqlite
        .query(
          `
            select
              provider,
              external_connection_id as externalConnectionId,
              access_token as accessToken,
              access_token_encrypted as accessTokenEncrypted,
              credential_key_version as credentialKeyVersion,
              institution_id as institutionId,
              institution_name as institutionName,
              plaid_item_id as plaidItemId,
              status
            from provider_connections
          `,
        )
        .get(),
    ).toEqual({
      accessToken: null,
      accessTokenEncrypted: expect.stringMatching(/^v1\.[^.]+\.[^.]+$/),
      credentialKeyVersion: 1,
      externalConnectionId: "item-sandbox-123",
      institutionId: "ins_109508",
      institutionName: "Vanguard",
      plaidItemId: "item-sandbox-123",
      provider: "plaid",
      status: "active",
    });
  });
});
