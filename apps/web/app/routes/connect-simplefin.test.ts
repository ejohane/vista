import { Database } from "bun:sqlite";
import { describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { action } from "./connect-simplefin";

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

function createWebRouteTestDatabase() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  applyMigrations(sqlite);

  return {
    d1: new FakeD1Database(sqlite) as unknown as D1Database,
    sqlite,
  };
}

function buildActionRequest(token: string) {
  const formData = new FormData();
  formData.set("setupToken", token);

  return new Request("http://localhost/connect/simplefin", {
    body: formData,
    method: "POST",
  });
}

describe("connect simplefin route action", () => {
  test("claims the setup token, runs the first sync immediately, and redirects back to the snapshot", async () => {
    const { d1, sqlite } = createWebRouteTestDatabase();
    const claimUrl = "https://bridge.simplefin.org/simplefin/claim/demo-token";
    const token = Buffer.from(claimUrl, "utf8").toString("base64");
    const accessUrl =
      "https://demo-user:demo-pass@bridge.simplefin.org/simplefin";
    const nowEpochSeconds = Math.floor(
      new Date("2026-03-18T20:00:00.000Z").getTime() / 1000,
    );
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const requestUrl = new URL(String(input));

      if (requestUrl.pathname.includes("/claim/")) {
        return new Response(accessUrl, { status: 200 });
      }

      if (requestUrl.pathname.endsWith("/accounts")) {
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
                transactions: [],
              },
            ],
            errors: [],
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        );
      }

      throw new Error(`Unexpected fetch URL ${requestUrl.toString()}`);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const response = (await action({
        context: {
          cloudflare: {
            env: {
              DB: d1,
            },
          },
        },
        request: buildActionRequest(token),
      } as never)) as Response;

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(
      sqlite.query("select count(*) as count from provider_connections").get(),
    ).toEqual({ count: 1 });
    expect(
      sqlite.query("select count(*) as count from accounts").get(),
    ).toEqual({ count: 1 });
    expect(
      sqlite.query("select count(*) as count from balance_snapshots").get(),
    ).toEqual({ count: 1 });
    expect(
      sqlite.query("select count(*) as count from sync_runs").get(),
    ).toEqual({ count: 1 });
  });

  test("returns an actionable error when the connection is saved but the first sync fails", async () => {
    const { d1, sqlite } = createWebRouteTestDatabase();
    const token = Buffer.from(
      "https://bridge.simplefin.org/simplefin/claim/demo-token",
      "utf8",
    ).toString("base64");
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const requestUrl = new URL(String(input));

      if (requestUrl.pathname.includes("/claim/")) {
        return new Response(
          "https://demo-user:demo-pass@bridge.simplefin.org/simplefin",
          { status: 200 },
        );
      }

      if (requestUrl.pathname.endsWith("/accounts")) {
        return new Response("forbidden", { status: 403 });
      }

      throw new Error(`Unexpected fetch URL ${requestUrl.toString()}`);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const result = await action({
        context: {
          cloudflare: {
            env: {
              DB: d1,
            },
          },
        },
        request: buildActionRequest(token),
      } as never);

      expect(result).toEqual({
        message:
          "SimpleFIN connection was saved, but the first sync failed: SimpleFIN /accounts returned 403 for connection conn:simplefin:claim:160cd115fed6f324122b692045e167246ccd3dcaaf7a25f90ca52f2431667eef.",
        ok: false,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(
      sqlite.query("select count(*) as count from provider_connections").get(),
    ).toEqual({ count: 1 });
    expect(
      sqlite.query("select count(*) as count from accounts").get(),
    ).toEqual({ count: 0 });
  });
});
