import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";

import { AccountReviewScreen, action } from "./account-review";

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

  async raw<T>() {
    return this.database
      .query(this.query)
      .values(...(this.values as never[])) as T[];
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

function createAccountReviewTestDatabase() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  applyMigrations(sqlite);

  const createdAt = new Date("2026-03-15T12:00:00.000Z").getTime();
  const syncedAt = new Date("2026-03-16T18:30:00.000Z").getTime();

  sqlite
    .query(
      `
        insert into households (id, name, last_synced_at, created_at)
        values (?, ?, ?, ?)
      `,
    )
    .run("household_demo", "Vista Household", syncedAt, createdAt);
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
      1284500,
      createdAt,
      syncedAt,
    );

  return {
    d1: new FakeD1Database(sqlite) as unknown as D1Database,
    sqlite,
  };
}

function buildActionRequest() {
  const formData = new FormData();
  formData.set("accountId", "acct_checking");
  formData.set("displayName", "Household Operating");
  formData.set("ownershipType", "mine");
  formData.set("isHidden", "on");

  return new Request("http://localhost/accounts/review", {
    body: formData,
    method: "POST",
  });
}

describe("account review route", () => {
  test("updates account curation and redirects back to the review screen", async () => {
    const { d1, sqlite } = createAccountReviewTestDatabase();

    const response = (await action({
      context: {
        cloudflare: {
          env: {
            DB: d1,
          },
        },
      },
      request: buildActionRequest(),
    } as never)) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/accounts/review?householdId=household_demo&updated=acct_checking",
    );
    expect(
      sqlite
        .query(
          `
            select
              display_name as displayName,
              ownership_type as ownershipType,
              include_in_household_reporting as includeInHouseholdReporting,
              is_hidden as isHidden
            from accounts
            where id = ?
          `,
        )
        .get("acct_checking"),
    ).toEqual({
      displayName: "Household Operating",
      includeInHouseholdReporting: 0,
      isHidden: 1,
      ownershipType: "mine",
    });
  });

  test("renders curated account controls and the saved-state banner", () => {
    const loaderData = {
      accounts: [
        {
          accountType: "checking" as const,
          balanceMinor: 1284500,
          displayName: "Household Operating",
          id: "acct_checking",
          includeInHouseholdReporting: false,
          institutionName: "US Bank",
          isHidden: true,
          name: "Everyday Checking",
          ownershipType: "mine" as const,
          reportingGroup: "cash" as const,
        },
        {
          accountType: "credit_card" as const,
          balanceMinor: -12345,
          displayName: null,
          id: "acct_credit_card",
          includeInHouseholdReporting: true,
          institutionName: "US Bank",
          isHidden: false,
          name: "Primary Credit Card",
          ownershipType: "joint" as const,
          reportingGroup: "liabilities" as const,
        },
      ],
      householdId: "household_demo",
      householdName: "Vista Household",
      kind: "ready" as const,
      lastSyncedAt: "2026-03-16T18:30:00.000Z",
      summary: {
        excludedCount: 1,
        hiddenCount: 1,
        includedCount: 1,
      },
      updatedAccountId: "acct_checking",
    };

    const router = createMemoryRouter(
      [
        {
          element: <AccountReviewScreen loaderData={loaderData} />,
          path: "/accounts/review",
        },
      ],
      { initialEntries: ["/accounts/review"] },
    );

    const html = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(html).toContain("Accounts");
    expect(html).toContain("Household Operating");
    expect(html).toContain("Excluded");
    expect(html).toContain("Credit Card");
    expect(html).toContain("$12,845.00");
  });
});
