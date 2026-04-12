import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import {
  createD1HouseholdService,
  exportHouseholdState,
  getDb,
  type HouseholdStateExport,
} from "@vista/db";

import { createHouseholdStateStore } from "./index";
import { createSqliteTestHouseholdDatabase } from "./testing";

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

function applySqlFiles(database: Database, directory: string) {
  const sqlFiles = readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  for (const fileName of sqlFiles) {
    database.exec(readFileSync(`${directory}/${fileName}`, "utf8"));
  }
}

function createLegacySeededDatabase() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  applySqlFiles(
    sqlite,
    new URL("../../../packages/db/migrations/", import.meta.url).pathname,
  );
  sqlite.exec(
    readFileSync(
      new URL("../../../packages/db/seeds/dev.sql", import.meta.url).pathname,
      "utf8",
    ),
  );

  const d1 = new FakeD1Database(sqlite) as unknown as D1Database;

  return {
    d1,
    service: createD1HouseholdService(getDb(d1)),
  };
}

async function exportDemoHousehold() {
  const legacy = createLegacySeededDatabase();
  const snapshot = await exportHouseholdState(legacy.d1, "household_demo");

  expect(snapshot).not.toBeNull();

  return {
    legacy,
    snapshot: snapshot as HouseholdStateExport,
  };
}

describe("household state store", () => {
  test("imports a legacy household snapshot and preserves homepage, portfolio, and account curation reads", async () => {
    const { legacy, snapshot } = await exportDemoHousehold();
    const { database } = createSqliteTestHouseholdDatabase();
    const stateStore = createHouseholdStateStore(database);

    await stateStore.importHouseholdState(snapshot);

    await expect(
      stateStore.getHomepageSnapshot("household_demo"),
    ).resolves.toEqual(
      await legacy.service.getHomepageSnapshot("household_demo"),
    );
    await expect(
      stateStore.getPortfolioSnapshot("household_demo"),
    ).resolves.toEqual(
      await legacy.service.getPortfolioSnapshot("household_demo"),
    );
    await expect(
      stateStore.getAccountCurationSnapshot("household_demo"),
    ).resolves.toEqual(
      await legacy.service.getAccountCurationSnapshot("household_demo"),
    );
  });

  test("applies account curation changes inside the household-local store", async () => {
    const { snapshot } = await exportDemoHousehold();
    const { database } = createSqliteTestHouseholdDatabase();
    const stateStore = createHouseholdStateStore(database);

    await stateStore.importHouseholdState(snapshot);
    await stateStore.updateAccountCuration({
      accountId: "acct_checking",
      displayName: "Household Operating",
      householdId: "household_demo",
      includeInHouseholdReporting: false,
      isHidden: true,
      ownershipType: "mine",
    });

    await expect(
      stateStore.getAccountCurationSnapshot("household_demo"),
    ).resolves.toEqual(
      expect.objectContaining({
        accounts: expect.arrayContaining([
          expect.objectContaining({
            displayName: "Household Operating",
            id: "acct_checking",
            includeInHouseholdReporting: false,
            isHidden: true,
            ownershipType: "mine",
          }),
        ]),
      }),
    );
  });

  test("keeps fixture sync ingestion idempotent inside household-local storage", async () => {
    const { snapshot } = await exportDemoHousehold();
    const { database } = createSqliteTestHouseholdDatabase();
    const stateStore = createHouseholdStateStore(database);

    await stateStore.importHouseholdState(snapshot);

    const firstResult = await stateStore.ingestFixtureSyncBatch({
      balances: [
        {
          accountId: "acct_checking",
          asOfDate: "2026-03-17",
          balanceMinor: 1102300,
          capturedAt: new Date("2026-03-17T18:30:00.000Z"),
          id: "snapshot_sync_demo_2026_03_17_acct_checking",
        },
      ],
      completedAt: new Date("2026-03-17T18:30:00.000Z"),
      householdId: "household_demo",
      runId: "sync_demo_2026_03_17",
      startedAt: new Date("2026-03-17T18:25:00.000Z"),
      trigger: "scheduled",
    });
    const secondResult = await stateStore.ingestFixtureSyncBatch({
      balances: [
        {
          accountId: "acct_checking",
          asOfDate: "2026-03-17",
          balanceMinor: 1102300,
          capturedAt: new Date("2026-03-17T18:30:00.000Z"),
          id: "snapshot_sync_demo_2026_03_17_acct_checking",
        },
      ],
      completedAt: new Date("2026-03-17T18:30:00.000Z"),
      householdId: "household_demo",
      runId: "sync_demo_2026_03_17",
      startedAt: new Date("2026-03-17T18:25:00.000Z"),
      trigger: "scheduled",
    });

    expect(firstResult).toEqual({
      completedAt: new Date("2026-03-17T18:30:00.000Z"),
      created: true,
      runId: "sync_demo_2026_03_17",
    });
    expect(secondResult).toEqual({
      completedAt: new Date("2026-03-17T18:30:00.000Z"),
      created: false,
      runId: "sync_demo_2026_03_17",
    });
    await expect(
      stateStore.getHomepageSnapshot("household_demo"),
    ).resolves.toEqual(
      expect.objectContaining({
        lastSyncedAt: new Date("2026-03-17T18:30:00.000Z"),
      }),
    );
  });
});
