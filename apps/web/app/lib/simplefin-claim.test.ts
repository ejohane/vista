import { Database } from "bun:sqlite";
import { describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { claimSimplefinSetupToken } from "./simplefin-claim";

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

describe("claimSimplefinSetupToken", () => {
  test("decodes a setup token, claims the access URL, creates a household if needed, and stores the SimpleFIN connection", async () => {
    const { d1, sqlite } = createWebTestDatabase();
    const claimUrl = "https://bridge.simplefin.org/simplefin/claim/demo-token";
    const token = Buffer.from(claimUrl, "utf8").toString("base64");
    const accessUrl =
      "https://demo-user:demo-pass@bridge.simplefin.org/simplefin";
    const expectedExternalConnectionId = `claim:${createHash("sha256")
      .update(claimUrl)
      .digest("hex")}`;
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(claimUrl);
        expect(init?.method).toBe("POST");

        return new Response(accessUrl, { status: 200 });
      },
    );

    const result = await claimSimplefinSetupToken({
      database: d1,
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: new Date("2026-03-18T20:00:00.000Z"),
      setupToken: token,
    });

    expect(result).toEqual({
      connectionId: `conn:simplefin:${expectedExternalConnectionId}`,
      householdId: "household_default",
      householdWasCreated: true,
    });
    expect(
      sqlite
        .query(
          `
            select
              provider,
              external_connection_id as externalConnectionId,
              access_url as accessUrl,
              status,
              household_id as householdId
            from provider_connections
          `,
        )
        .get(),
    ).toEqual({
      accessUrl,
      externalConnectionId: expectedExternalConnectionId,
      householdId: "household_default",
      provider: "simplefin",
      status: "active",
    });
    expect(
      sqlite
        .query(
          `
            select id, name
            from households
          `,
        )
        .get(),
    ).toEqual({
      id: "household_default",
      name: "Vista Household",
    });
  });

  test("updates an existing SimpleFIN connection for the same claimed token instead of creating duplicates", async () => {
    const { d1, sqlite } = createWebTestDatabase();
    const createdAt = new Date("2026-03-17T20:00:00.000Z").getTime();
    const claimUrl = "https://bridge.simplefin.org/simplefin/claim/demo-token";
    const token = Buffer.from(claimUrl, "utf8").toString("base64");
    const expectedExternalConnectionId = `claim:${createHash("sha256")
      .update(claimUrl)
      .digest("hex")}`;

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
            access_url,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        `conn:simplefin:${expectedExternalConnectionId}`,
        "household_demo",
        "simplefin",
        "error",
        expectedExternalConnectionId,
        "https://stale-user:stale-pass@bridge.simplefin.org/simplefin",
        createdAt,
        createdAt,
      );

    const fetchMock = mock(async () => {
      return new Response(
        "https://fresh-user:fresh-pass@bridge.simplefin.org/simplefin",
        { status: 200 },
      );
    });

    const result = await claimSimplefinSetupToken({
      database: d1,
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: new Date("2026-03-18T20:00:00.000Z"),
      setupToken: token,
    });

    expect(result).toEqual({
      connectionId: `conn:simplefin:${expectedExternalConnectionId}`,
      householdId: "household_demo",
      householdWasCreated: false,
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
              access_url as accessUrl
            from provider_connections
          `,
        )
        .get(),
    ).toEqual({
      accessUrl: "https://fresh-user:fresh-pass@bridge.simplefin.org/simplefin",
      status: "active",
    });
  });

  test("surfaces claim failures and leaves the database untouched", async () => {
    const { d1, sqlite } = createWebTestDatabase();
    const token = Buffer.from(
      "https://bridge.simplefin.org/simplefin/claim/invalid",
      "utf8",
    ).toString("base64");
    const fetchMock = mock(async () => {
      return new Response("forbidden", { status: 403 });
    });

    await expect(
      claimSimplefinSetupToken({
        database: d1,
        fetchImpl: fetchMock as unknown as typeof fetch,
        now: new Date("2026-03-18T20:00:00.000Z"),
        setupToken: token,
      }),
    ).rejects.toThrow("403");

    expect(
      sqlite.query("select count(*) as count from households").get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite.query("select count(*) as count from provider_connections").get(),
    ).toEqual({ count: 0 });
  });
});
