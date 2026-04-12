import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getDb } from "./client";
import {
  createD1HouseholdAccess,
  resolveHouseholdSelection,
} from "./households";

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

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  applyMigrations(sqlite);

  const d1 = new FakeD1Database(sqlite) as unknown as D1Database;

  return {
    db: getDb(d1),
    sqlite,
  };
}

function insertHousehold(
  sqlite: Database,
  household: { createdAt: Date; id: string; name: string },
) {
  sqlite
    .query(
      `
        insert into households (id, name, last_synced_at, created_at)
        values (?, ?, ?, ?)
      `,
    )
    .run(
      household.id,
      household.name,
      household.createdAt.getTime(),
      household.createdAt.getTime(),
    );
}

describe("resolveHouseholdSelection", () => {
  test("returns null when no households exist", async () => {
    const { db } = createTestDb();

    await expect(
      resolveHouseholdSelection(createD1HouseholdAccess(db), null),
    ).resolves.toBeNull();
  });

  test("returns the requested household when it exists", async () => {
    const { db, sqlite } = createTestDb();

    insertHousehold(sqlite, {
      createdAt: new Date("2026-03-15T12:00:00.000Z"),
      id: "household_alpha",
      name: "Alpha Household",
    });

    await expect(
      resolveHouseholdSelection(createD1HouseholdAccess(db), "household_alpha"),
    ).resolves.toEqual({
      id: "household_alpha",
      lastSyncedAt: new Date("2026-03-15T12:00:00.000Z"),
      name: "Alpha Household",
    });
  });

  test("returns the only household when exactly one household exists", async () => {
    const { db, sqlite } = createTestDb();

    insertHousehold(sqlite, {
      createdAt: new Date("2026-03-15T12:00:00.000Z"),
      id: "household_alpha",
      name: "Alpha Household",
    });

    await expect(
      resolveHouseholdSelection(createD1HouseholdAccess(db), null),
    ).resolves.toEqual({
      id: "household_alpha",
      lastSyncedAt: new Date("2026-03-15T12:00:00.000Z"),
      name: "Alpha Household",
    });
  });

  test("throws when the requested household does not exist", async () => {
    const { db, sqlite } = createTestDb();

    insertHousehold(sqlite, {
      createdAt: new Date("2026-03-15T12:00:00.000Z"),
      id: "household_alpha",
      name: "Alpha Household",
    });

    await expect(
      resolveHouseholdSelection(createD1HouseholdAccess(db), "missing"),
    ).rejects.toThrow("Household missing could not be found.");
  });

  test("throws when multiple households exist and no household id was provided", async () => {
    const { db, sqlite } = createTestDb();

    insertHousehold(sqlite, {
      createdAt: new Date("2026-03-15T12:00:00.000Z"),
      id: "household_alpha",
      name: "Alpha Household",
    });
    insertHousehold(sqlite, {
      createdAt: new Date("2026-03-15T12:05:00.000Z"),
      id: "household_beta",
      name: "Beta Household",
    });

    await expect(
      resolveHouseholdSelection(createD1HouseholdAccess(db), null),
    ).rejects.toThrow(
      "Multiple households are available. Pass householdId explicitly.",
    );
  });
});
