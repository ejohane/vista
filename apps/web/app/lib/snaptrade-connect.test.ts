import { Database } from "bun:sqlite";
import { describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  beginSnaptradeConnection,
  completeSnaptradeConnection,
} from "./snaptrade-connect";

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

describe("beginSnaptradeConnection", () => {
  test("registers a SnapTrade user when needed, stores a pending draft row, and returns the redirect URL", async () => {
    const { d1, sqlite } = createWebTestDatabase();
    const registerMock = mock(async ({ userId }: { userId: string }) => {
      expect(userId).toBe("household_default");

      return {
        userId,
        userSecret: "secret-new",
      };
    });
    const loginMock = mock(
      async ({
        customRedirect,
        immediateRedirect,
        userId,
        userSecret,
      }: {
        customRedirect?: string;
        immediateRedirect?: boolean;
        userId: string;
        userSecret: string;
      }) => {
        expect(userId).toBe("household_default");
        expect(userSecret).toBe("secret-new");
        expect(immediateRedirect).toBe(true);
        expect(customRedirect).toBe(
          "http://localhost/connect/snaptrade/callback?draftConnectionId=conn%3Asnaptrade%3Adraft%3Adraft-001",
        );

        return {
          redirectUri: "https://app.snaptrade.com/snapTrade/redeemToken?demo=1",
          sessionId: "session-001",
        };
      },
    );

    const result = await beginSnaptradeConnection({
      client: {
        listBrokerageAuthorizations: mock(async () => []),
        loginSnapTradeUser: loginMock,
        registerSnapTradeUser: registerMock,
      },
      database: d1,
      draftIdFactory: () => "draft-001",
      now: new Date("2026-03-19T13:00:00.000Z"),
      redirectUrl: "http://localhost/connect/snaptrade/callback",
    });

    expect(result).toEqual({
      connectionDraftId: "conn:snaptrade:draft:draft-001",
      householdId: "household_default",
      householdWasCreated: true,
      redirectUri: "https://app.snaptrade.com/snapTrade/redeemToken?demo=1",
    });
    expect(
      sqlite
        .query(
          `
            select
              provider,
              status,
              household_id as householdId,
              external_connection_id as externalConnectionId,
              access_secret as accessSecret
            from provider_connections
          `,
        )
        .get(),
    ).toEqual({
      accessSecret: "secret-new",
      externalConnectionId: "pending:draft-001",
      householdId: "household_default",
      provider: "snaptrade",
      status: "disconnected",
    });
  });

  test("reuses the latest stored SnapTrade secret for the household instead of registering again", async () => {
    const { d1, sqlite } = createWebTestDatabase();
    const createdAt = new Date("2026-03-18T13:00:00.000Z").getTime();
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
        "conn:snaptrade:existing",
        "household_demo",
        "snaptrade",
        "active",
        "auth-existing",
        "secret-existing",
        createdAt,
        createdAt,
      );
    const registerMock = mock(async () => {
      throw new Error("registerSnapTradeUser should not be called");
    });
    const loginMock = mock(
      async ({ userSecret }: { userId: string; userSecret: string }) => {
        expect(userSecret).toBe("secret-existing");

        return {
          redirectUri: "https://app.snaptrade.com/snapTrade/redeemToken?demo=2",
          sessionId: "session-002",
        };
      },
    );

    const result = await beginSnaptradeConnection({
      client: {
        listBrokerageAuthorizations: mock(async () => []),
        loginSnapTradeUser: loginMock,
        registerSnapTradeUser: registerMock,
      },
      database: d1,
      draftIdFactory: () => "draft-002",
      now: new Date("2026-03-19T13:00:00.000Z"),
      redirectUrl: "http://localhost/connect/snaptrade/callback",
    });

    expect(result).toEqual({
      connectionDraftId: "conn:snaptrade:draft:draft-002",
      householdId: "household_demo",
      householdWasCreated: false,
      redirectUri: "https://app.snaptrade.com/snapTrade/redeemToken?demo=2",
    });
    expect(registerMock).toHaveBeenCalledTimes(0);
    expect(
      sqlite.query("select count(*) as count from provider_connections").get(),
    ).toEqual({ count: 2 });
  });
});

describe("completeSnaptradeConnection", () => {
  test("converts a pending draft row into an active connection after the callback succeeds", async () => {
    const { d1, sqlite } = createWebTestDatabase();
    const createdAt = new Date("2026-03-19T13:00:00.000Z").getTime();

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
        "conn:snaptrade:draft:draft-003",
        "household_demo",
        "snaptrade",
        "disconnected",
        "pending:draft-003",
        "secret-draft",
        createdAt,
        createdAt,
      );

    const result = await completeSnaptradeConnection({
      callbackConnectionId: "authorization-123",
      client: {
        listBrokerageAuthorizations: mock(async () => [
          {
            brokerage: {
              display_name: "Vanguard",
            },
            disabled: false,
            id: "authorization-123",
          },
        ]),
        loginSnapTradeUser: mock(async () => {
          throw new Error("loginSnapTradeUser should not be called");
        }),
        registerSnapTradeUser: mock(async () => {
          throw new Error("registerSnapTradeUser should not be called");
        }),
      },
      connectionDraftId: "conn:snaptrade:draft:draft-003",
      database: d1,
      now: new Date("2026-03-19T14:00:00.000Z"),
    });

    expect(result).toEqual({
      brokerageName: "Vanguard",
      connectionId: "conn:snaptrade:draft:draft-003",
      householdId: "household_demo",
      status: "active",
    });
    expect(
      sqlite
        .query(
          `
            select
              external_connection_id as externalConnectionId,
              status,
              access_secret as accessSecret
            from provider_connections
            where id = ?
          `,
        )
        .get("conn:snaptrade:draft:draft-003"),
    ).toEqual({
      accessSecret: "secret-draft",
      externalConnectionId: "authorization-123",
      status: "active",
    });
  });

  test("deduplicates against an existing saved connection when SnapTrade returns the same authorization id", async () => {
    const { d1, sqlite } = createWebTestDatabase();
    const createdAt = new Date("2026-03-19T13:00:00.000Z").getTime();

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
        "conn:snaptrade:existing",
        "household_demo",
        "snaptrade",
        "error",
        "authorization-456",
        "secret-stale",
        createdAt,
        createdAt,
      );
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
        "conn:snaptrade:draft:draft-004",
        "household_demo",
        "snaptrade",
        "disconnected",
        "pending:draft-004",
        "secret-fresh",
        createdAt,
        createdAt,
      );

    const result = await completeSnaptradeConnection({
      callbackConnectionId: "authorization-456",
      client: {
        listBrokerageAuthorizations: mock(async () => [
          {
            brokerage: {
              display_name: "Robinhood",
            },
            disabled: false,
            id: "authorization-456",
          },
        ]),
        loginSnapTradeUser: mock(async () => {
          throw new Error("loginSnapTradeUser should not be called");
        }),
        registerSnapTradeUser: mock(async () => {
          throw new Error("registerSnapTradeUser should not be called");
        }),
      },
      connectionDraftId: "conn:snaptrade:draft:draft-004",
      database: d1,
      now: new Date("2026-03-19T14:00:00.000Z"),
    });

    expect(result).toEqual({
      brokerageName: "Robinhood",
      connectionId: "conn:snaptrade:existing",
      householdId: "household_demo",
      status: "active",
    });
    expect(
      sqlite.query("select count(*) as count from provider_connections").get(),
    ).toEqual({ count: 1 });
    expect(
      sqlite
        .query(
          `
            select
              status,
              access_secret as accessSecret
            from provider_connections
            where id = ?
          `,
        )
        .get("conn:snaptrade:existing"),
    ).toEqual({
      accessSecret: "secret-fresh",
      status: "active",
    });
  });
});
