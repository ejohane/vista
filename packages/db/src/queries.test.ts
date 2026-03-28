import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getDb } from "./client";
import { getDashboardSnapshot, getHomepageSnapshot } from "./queries";

const createdAt = new Date("2026-03-15T12:00:00.000Z");
const firstCompletedAt = new Date("2026-03-15T18:30:00.000Z");
const secondCompletedAt = new Date("2026-03-16T18:30:00.000Z");

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

  sqlite
    .query(
      `
        insert into households (id, name, last_synced_at, created_at)
        values (?, ?, ?, ?)
      `,
    )
    .run(
      "household_demo",
      "Vista Household",
      secondCompletedAt.getTime(),
      createdAt.getTime(),
    );

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
    "acct_checking",
    "household_demo",
    "Everyday Checking",
    "US Bank",
    "checking",
    "cash",
    99,
    createdAt.getTime(),
    secondCompletedAt.getTime(),
  );
  insertAccount.run(
    "acct_savings",
    "household_demo",
    "Rainy Day Savings",
    "US Bank",
    "savings",
    "cash",
    88,
    createdAt.getTime(),
    secondCompletedAt.getTime(),
  );
  insertAccount.run(
    "acct_brokerage",
    "household_demo",
    "Taxable Brokerage",
    "Vanguard",
    "brokerage",
    "investments",
    77,
    createdAt.getTime(),
    secondCompletedAt.getTime(),
  );
  insertAccount.run(
    "acct_retirement",
    "household_demo",
    "Rollover IRA",
    "Vanguard",
    "retirement",
    "investments",
    66,
    createdAt.getTime(),
    secondCompletedAt.getTime(),
  );

  const fakeD1 = new FakeD1Database(sqlite) as unknown as D1Database;

  return {
    db: getDb(fakeD1),
    sqlite,
  };
}

function insertSucceededRun(
  sqlite: Database,
  values: {
    balances: Record<string, number>;
    completedAt: Date;
    provider?: "plaid" | "simplefin" | "snaptrade";
    providerConnectionId?: string;
    runId: string;
    startedAt: Date;
  },
) {
  sqlite
    .query(
      `
        insert into sync_runs (
          id,
          household_id,
          status,
          trigger,
          started_at,
          completed_at
      )
      values (?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      values.runId,
      "household_demo",
      "succeeded",
      "seed",
      values.startedAt.getTime(),
      values.completedAt.getTime(),
    );

  if (values.provider || values.providerConnectionId) {
    sqlite
      .query(
        `
          update sync_runs
          set provider = ?, provider_connection_id = ?
          where id = ?
        `,
      )
      .run(
        values.provider ?? null,
        values.providerConnectionId ?? null,
        values.runId,
      );
  }

  const insertSnapshot = sqlite.query(
    `
      insert into balance_snapshots (
        id,
        account_id,
        source_sync_run_id,
        captured_at,
        as_of_date,
        balance_minor
      )
      values (?, ?, ?, ?, ?, ?)
    `,
  );

  for (const [accountId, balanceMinor] of Object.entries(values.balances)) {
    insertSnapshot.run(
      `snapshot_${values.runId}_${accountId}`,
      accountId,
      values.runId,
      values.completedAt.getTime(),
      values.completedAt.toISOString().slice(0, 10),
      balanceMinor,
    );
  }
}

function insertProviderConnection(
  sqlite: Database,
  values: {
    accessToken?: null | string;
    accessSecret?: null | string;
    accessUrl?: null | string;
    connectionId: string;
    externalConnectionId: string;
    provider: "plaid" | "simplefin" | "snaptrade";
    status: "active" | "disconnected" | "error";
  },
) {
  sqlite
    .query(
      `
        insert into provider_connections (
          id,
          household_id,
          provider,
          external_connection_id,
          status,
          access_token,
          access_url,
          access_secret,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      values.connectionId,
      "household_demo",
      values.provider,
      values.externalConnectionId,
      values.status,
      values.accessToken ?? null,
      values.accessUrl ?? null,
      values.accessSecret ?? null,
      createdAt.getTime(),
      secondCompletedAt.getTime(),
    );
}

describe("getDashboardSnapshot", () => {
  test("falls back to legacy account balances when no successful sync runs exist yet", async () => {
    const { db } = createTestDb();

    const snapshot = await getDashboardSnapshot(db);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.hasSuccessfulSync).toBe(false);
    expect(snapshot?.changeSummary).toBeNull();
    expect(snapshot?.totals).toEqual({
      cashMinor: 187,
      investmentsMinor: 143,
      netWorthMinor: 330,
    });
    expect(snapshot?.accountTypeGroups.map((group) => group.key)).toEqual([
      "checking",
      "savings",
      "brokerage",
      "retirement",
    ]);
  });

  test("aggregates the dashboard from balance snapshots instead of legacy account balances", async () => {
    const { db, sqlite } = createTestDb();

    insertSucceededRun(sqlite, {
      balances: {
        acct_brokerage: 16180000,
        acct_checking: 1240000,
        acct_retirement: 24280000,
        acct_savings: 3500000,
      },
      completedAt: firstCompletedAt,
      runId: "sync_seed_2026_03_15",
      startedAt: new Date("2026-03-15T18:25:00.000Z"),
    });
    insertSucceededRun(sqlite, {
      balances: {
        acct_brokerage: 16450320,
        acct_checking: 1284500,
        acct_retirement: 24311890,
        acct_savings: 3527600,
      },
      completedAt: secondCompletedAt,
      runId: "sync_seed_2026_03_16",
      startedAt: new Date("2026-03-16T18:25:00.000Z"),
    });

    const snapshot = await getDashboardSnapshot(db);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.hasSuccessfulSync).toBe(true);
    expect(snapshot?.lastSyncedAt.toISOString()).toBe(
      "2026-03-16T18:30:00.000Z",
    );
    expect(snapshot?.totals).toEqual({
      cashMinor: 4812100,
      investmentsMinor: 40762210,
      netWorthMinor: 45574310,
    });
    expect(snapshot?.accountTypeGroups.map((group) => group.key)).toEqual([
      "checking",
      "savings",
      "brokerage",
      "retirement",
    ]);
    expect(snapshot?.accountTypeGroups[0]?.accounts[0]?.balanceMinor).toBe(
      1284500,
    );
  });

  test("treats credit-card balances as liabilities instead of cash", async () => {
    const { db, sqlite } = createTestDb();

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
        "acct_credit_card",
        "household_demo",
        "Primary Credit Card",
        "US Bank",
        "credit_card",
        "liabilities",
        -12345,
        createdAt.getTime(),
        secondCompletedAt.getTime(),
      );

    insertSucceededRun(sqlite, {
      balances: {
        acct_brokerage: 16450320,
        acct_checking: 1284500,
        acct_credit_card: -12345,
        acct_retirement: 24311890,
        acct_savings: 3527600,
      },
      completedAt: secondCompletedAt,
      runId: "sync_seed_2026_03_16",
      startedAt: new Date("2026-03-16T18:25:00.000Z"),
    });

    const snapshot = await getDashboardSnapshot(db);

    expect(snapshot?.totals).toEqual({
      cashMinor: 4812100,
      investmentsMinor: 40762210,
      netWorthMinor: 45561965,
    });
    expect(snapshot?.accountTypeGroups.map((group) => group.key)).toEqual([
      "checking",
      "savings",
      "credit_card",
      "brokerage",
      "retirement",
    ]);
    expect(snapshot?.accountTypeGroups[2]).toEqual({
      accounts: [
        {
          accountType: "credit_card",
          balanceMinor: -12345,
          id: "acct_credit_card",
          institutionName: "US Bank",
          name: "Primary Credit Card",
        },
      ],
      key: "credit_card",
      label: "Credit Card",
      totalMinor: -12345,
    });
  });

  test("computes deltas for totals, account groups, and the top changed accounts", async () => {
    const { db, sqlite } = createTestDb();

    insertSucceededRun(sqlite, {
      balances: {
        acct_brokerage: 16180000,
        acct_checking: 1240000,
        acct_retirement: 24280000,
        acct_savings: 3500000,
      },
      completedAt: firstCompletedAt,
      runId: "sync_seed_2026_03_15",
      startedAt: new Date("2026-03-15T18:25:00.000Z"),
    });
    insertSucceededRun(sqlite, {
      balances: {
        acct_brokerage: 16450320,
        acct_checking: 1284500,
        acct_retirement: 24311890,
        acct_savings: 3527600,
      },
      completedAt: secondCompletedAt,
      runId: "sync_seed_2026_03_16",
      startedAt: new Date("2026-03-16T18:25:00.000Z"),
    });

    const snapshot = await getDashboardSnapshot(db);

    expect(snapshot?.hasSuccessfulSync).toBe(true);
    expect(snapshot?.changeSummary).toEqual({
      cashDeltaMinor: 72100,
      changedAccounts: [
        {
          accountType: "brokerage",
          deltaMinor: 270320,
          id: "acct_brokerage",
          institutionName: "Vanguard",
          latestBalanceMinor: 16450320,
          name: "Taxable Brokerage",
          previousBalanceMinor: 16180000,
        },
        {
          accountType: "checking",
          deltaMinor: 44500,
          id: "acct_checking",
          institutionName: "US Bank",
          latestBalanceMinor: 1284500,
          name: "Everyday Checking",
          previousBalanceMinor: 1240000,
        },
        {
          accountType: "retirement",
          deltaMinor: 31890,
          id: "acct_retirement",
          institutionName: "Vanguard",
          latestBalanceMinor: 24311890,
          name: "Rollover IRA",
          previousBalanceMinor: 24280000,
        },
      ],
      changedGroups: [
        {
          deltaMinor: 270320,
          key: "brokerage",
          label: "Brokerage",
          latestTotalMinor: 16450320,
          previousTotalMinor: 16180000,
        },
        {
          deltaMinor: 44500,
          key: "checking",
          label: "Checking",
          latestTotalMinor: 1284500,
          previousTotalMinor: 1240000,
        },
        {
          deltaMinor: 31890,
          key: "retirement",
          label: "Retirement",
          latestTotalMinor: 24311890,
          previousTotalMinor: 24280000,
        },
        {
          deltaMinor: 27600,
          key: "savings",
          label: "Savings",
          latestTotalMinor: 3527600,
          previousTotalMinor: 3500000,
        },
      ],
      comparedToCompletedAt: firstCompletedAt,
      investmentsDeltaMinor: 302210,
      netWorthDeltaMinor: 374310,
    });
  });

  test("returns a snapshot without a change summary when only one successful run exists", async () => {
    const { db, sqlite } = createTestDb();

    insertSucceededRun(sqlite, {
      balances: {
        acct_brokerage: 16450320,
        acct_checking: 1284500,
        acct_retirement: 24311890,
        acct_savings: 3527600,
      },
      completedAt: secondCompletedAt,
      runId: "sync_seed_2026_03_16",
      startedAt: new Date("2026-03-16T18:25:00.000Z"),
    });

    const snapshot = await getDashboardSnapshot(db);

    expect(snapshot?.hasSuccessfulSync).toBe(true);
    expect(snapshot?.changeSummary).toBeNull();
    expect(snapshot?.totals.netWorthMinor).toBe(45574310);
  });

  test("honors account curation for display names, reporting exclusion, and hidden presentation", async () => {
    const { db, sqlite } = createTestDb();

    sqlite
      .query(
        `
          update accounts
          set
            display_name = ?,
            include_in_household_reporting = ?,
            is_hidden = ?
          where id = ?
        `,
      )
      .run("Household Checking", 1, 0, "acct_checking");
    sqlite
      .query(
        `
          update accounts
          set include_in_household_reporting = ?
          where id = ?
        `,
      )
      .run(0, "acct_savings");
    sqlite
      .query(
        `
          update accounts
          set is_hidden = ?
          where id = ?
        `,
      )
      .run(1, "acct_retirement");

    insertSucceededRun(sqlite, {
      balances: {
        acct_brokerage: 16180000,
        acct_checking: 1240000,
        acct_retirement: 24280000,
        acct_savings: 3500000,
      },
      completedAt: firstCompletedAt,
      runId: "sync_seed_2026_03_15",
      startedAt: new Date("2026-03-15T18:25:00.000Z"),
    });
    insertSucceededRun(sqlite, {
      balances: {
        acct_brokerage: 16450320,
        acct_checking: 1284500,
        acct_retirement: 24311890,
        acct_savings: 3527600,
      },
      completedAt: secondCompletedAt,
      runId: "sync_seed_2026_03_16",
      startedAt: new Date("2026-03-16T18:25:00.000Z"),
    });

    const snapshot = await getDashboardSnapshot(db);

    expect(snapshot?.totals).toEqual({
      cashMinor: 1284500,
      investmentsMinor: 40762210,
      netWorthMinor: 42046710,
    });
    expect(snapshot?.accountTypeGroups.map((group) => group.key)).toEqual([
      "checking",
      "brokerage",
    ]);
    expect(snapshot?.accountTypeGroups[0]?.accounts).toEqual([
      {
        accountType: "checking",
        balanceMinor: 1284500,
        id: "acct_checking",
        institutionName: "US Bank",
        name: "Household Checking",
      },
    ]);
    expect(snapshot?.changeSummary).toEqual({
      cashDeltaMinor: 44500,
      changedAccounts: [
        {
          accountType: "brokerage",
          deltaMinor: 270320,
          id: "acct_brokerage",
          institutionName: "Vanguard",
          latestBalanceMinor: 16450320,
          name: "Taxable Brokerage",
          previousBalanceMinor: 16180000,
        },
        {
          accountType: "checking",
          deltaMinor: 44500,
          id: "acct_checking",
          institutionName: "US Bank",
          latestBalanceMinor: 1284500,
          name: "Household Checking",
          previousBalanceMinor: 1240000,
        },
      ],
      changedGroups: [
        {
          deltaMinor: 270320,
          key: "brokerage",
          label: "Brokerage",
          latestTotalMinor: 16450320,
          previousTotalMinor: 16180000,
        },
        {
          deltaMinor: 44500,
          key: "checking",
          label: "Checking",
          latestTotalMinor: 1284500,
          previousTotalMinor: 1240000,
        },
        {
          deltaMinor: 31890,
          key: "retirement",
          label: "Retirement",
          latestTotalMinor: 24311890,
          previousTotalMinor: 24280000,
        },
      ],
      comparedToCompletedAt: firstCompletedAt,
      investmentsDeltaMinor: 302210,
      netWorthDeltaMinor: 346710,
    });
  });

  test("returns null when the household cannot be found", async () => {
    const { db } = createTestDb();

    await expect(getDashboardSnapshot(db, "missing")).resolves.toBeNull();
  });
});

describe("getHomepageSnapshot", () => {
  test("returns reporting groups, history, and provider connection state for the homepage", async () => {
    const { db, sqlite } = createTestDb();

    insertProviderConnection(sqlite, {
      accessUrl: "https://bridge.simplefin.org/access/demo",
      connectionId: "conn_simplefin_primary",
      externalConnectionId: "simplefin_primary",
      provider: "simplefin",
      status: "active",
    });
    insertSucceededRun(sqlite, {
      balances: {
        acct_brokerage: 16180000,
        acct_checking: 1240000,
        acct_retirement: 24280000,
        acct_savings: 3500000,
      },
      completedAt: firstCompletedAt,
      provider: "simplefin",
      providerConnectionId: "conn_simplefin_primary",
      runId: "sync_seed_2026_03_15",
      startedAt: new Date("2026-03-15T18:25:00.000Z"),
    });
    insertSucceededRun(sqlite, {
      balances: {
        acct_brokerage: 16450320,
        acct_checking: 1284500,
        acct_retirement: 24311890,
        acct_savings: 3527600,
      },
      completedAt: secondCompletedAt,
      provider: "simplefin",
      providerConnectionId: "conn_simplefin_primary",
      runId: "sync_seed_2026_03_16",
      startedAt: new Date("2026-03-16T18:25:00.000Z"),
    });

    const snapshot = await getHomepageSnapshot(db);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.reportingGroups).toEqual([
      {
        accounts: [
          {
            balanceMinor: 3527600,
            id: "acct_savings",
            institutionName: "US Bank",
            name: "Rainy Day Savings",
          },
          {
            balanceMinor: 1284500,
            id: "acct_checking",
            institutionName: "US Bank",
            name: "Everyday Checking",
          },
        ],
        key: "cash",
        label: "Cash",
        totalMinor: 4812100,
      },
      {
        accounts: [
          {
            balanceMinor: 24311890,
            id: "acct_retirement",
            institutionName: "Vanguard",
            name: "Rollover IRA",
          },
          {
            balanceMinor: 16450320,
            id: "acct_brokerage",
            institutionName: "Vanguard",
            name: "Taxable Brokerage",
          },
        ],
        key: "investments",
        label: "Investments",
        totalMinor: 40762210,
      },
    ]);
    expect(snapshot?.history).toHaveLength(2);
    expect(snapshot?.connectionStates).toEqual([
      {
        configuredConnectionCount: 0,
        lastSuccessfulSyncAt: null,
        latestRunAt: null,
        latestRunStatus: "never",
        provider: "plaid",
        status: "not_connected",
      },
      {
        configuredConnectionCount: 1,
        lastSuccessfulSyncAt: secondCompletedAt,
        latestRunAt: secondCompletedAt,
        latestRunStatus: "succeeded",
        provider: "simplefin",
        status: "active",
      },
      {
        configuredConnectionCount: 0,
        lastSuccessfulSyncAt: null,
        latestRunAt: null,
        latestRunStatus: "never",
        provider: "snaptrade",
        status: "not_connected",
      },
    ]);
  });

  test("returns provider attention states even before the first successful sync", async () => {
    const { db, sqlite } = createTestDb();

    insertProviderConnection(sqlite, {
      accessSecret: "snaptrade-secret",
      connectionId: "conn_snaptrade_primary",
      externalConnectionId: "snaptrade_primary",
      provider: "snaptrade",
      status: "error",
    });

    const snapshot = await getHomepageSnapshot(db);

    expect(snapshot?.hasSuccessfulSync).toBe(false);
    expect(snapshot?.connectionStates).toEqual([
      {
        configuredConnectionCount: 0,
        lastSuccessfulSyncAt: null,
        latestRunAt: null,
        latestRunStatus: "never",
        provider: "plaid",
        status: "not_connected",
      },
      {
        configuredConnectionCount: 0,
        lastSuccessfulSyncAt: null,
        latestRunAt: null,
        latestRunStatus: "never",
        provider: "simplefin",
        status: "not_connected",
      },
      {
        configuredConnectionCount: 0,
        lastSuccessfulSyncAt: null,
        latestRunAt: null,
        latestRunStatus: "never",
        provider: "snaptrade",
        status: "error",
      },
    ]);
  });
});
