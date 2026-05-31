import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type LocalD1Database, openLocalD1Database } from "./local-d1";
import { ensureLocalSchema } from "./schema";
import {
  getSyncRun,
  getVistaStatusSummary,
  listSyncRuns,
  parseSyncRunsArgs,
} from "./status";

function createTempDatabasePath() {
  const dir = mkdtempSync(join(tmpdir(), "vista-status-test-"));

  return {
    cleanup: () => rmSync(dir, { force: true, recursive: true }),
    path: join(dir, "vista.sqlite"),
  };
}

async function makeDatabase() {
  const temp = createTempDatabasePath();
  const database = openLocalD1Database(temp.path);

  await ensureLocalSchema(database);
  seedOperationalStatusData(database);

  return {
    cleanup: temp.cleanup,
    database,
  };
}

function seedOperationalStatusData(database: LocalD1Database) {
  const createdAt = Date.parse("2026-05-30T08:00:00.000Z");
  const plaidSucceededAt = Date.parse("2026-05-30T10:01:00.000Z");
  const plaidFailedStartedAt = Date.parse("2026-05-30T11:00:00.000Z");
  const plaidFailedAt = Date.parse("2026-05-30T11:01:00.000Z");
  const coinbaseSucceededAt = Date.parse("2026-05-28T10:01:00.000Z");

  database.sqlite
    .query(
      `
        insert into households (id, name, last_synced_at, created_at)
        values (?, ?, ?, ?)
      `,
    )
    .run("household_default", "Vista Household", plaidSucceededAt, createdAt);

  for (const connection of [
    {
      externalConnectionId: "item-chase",
      id: "conn_plaid_chase",
      institutionName: "Chase",
      provider: "plaid",
    },
    {
      externalConnectionId: "api-key-coinbase",
      id: "conn_coinbase",
      institutionName: "Coinbase",
      provider: "coinbase",
    },
    {
      externalConnectionId: "item-healthequity",
      id: "conn_plaid_healthequity",
      institutionName: "Health Equity",
      provider: "plaid",
    },
  ]) {
    database.sqlite
      .query(
        `
          insert into provider_connections (
            id,
            household_id,
            provider,
            status,
            external_connection_id,
            institution_name,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        connection.id,
        "household_default",
        connection.provider,
        "active",
        connection.externalConnectionId,
        connection.institutionName,
        createdAt,
        createdAt,
      );
  }

  for (const run of [
    {
      completedAt: plaidSucceededAt,
      connectionId: "conn_plaid_chase",
      errorSummary: null,
      id: "sync_plaid_success",
      provider: "plaid",
      recordsChanged: 4,
      startedAt: Date.parse("2026-05-30T10:00:00.000Z"),
      status: "succeeded",
    },
    {
      completedAt: plaidFailedAt,
      connectionId: "conn_plaid_chase",
      errorSummary: "rate limited",
      id: "sync_plaid_failed",
      provider: "plaid",
      recordsChanged: 0,
      startedAt: plaidFailedStartedAt,
      status: "failed",
    },
    {
      completedAt: coinbaseSucceededAt,
      connectionId: "conn_coinbase",
      errorSummary: null,
      id: "sync_coinbase_success",
      provider: "coinbase",
      recordsChanged: 3,
      startedAt: Date.parse("2026-05-28T10:00:00.000Z"),
      status: "succeeded",
    },
  ]) {
    database.sqlite
      .query(
        `
          insert into sync_runs (
            id,
            household_id,
            provider_connection_id,
            provider,
            status,
            trigger,
            started_at,
            completed_at,
            records_changed,
            error_summary
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        run.id,
        "household_default",
        run.connectionId,
        run.provider,
        run.status,
        "scheduled",
        run.startedAt,
        run.completedAt,
        run.recordsChanged,
        run.errorSummary,
      );
  }

  database.sqlite
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
        values (?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      "acct_cash",
      "household_default",
      "Checking",
      "Chase",
      "checking",
      "cash",
      100_00,
      createdAt,
      createdAt,
      "acct_investment",
      "household_default",
      "Brokerage",
      "Coinbase",
      "brokerage",
      "investments",
      500_00,
      createdAt,
      createdAt,
    );
  database.sqlite
    .query(
      `
        insert into holdings (
          id,
          account_id,
          holding_key,
          symbol,
          name,
          asset_class,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      "holding_btc",
      "acct_investment",
      "BTC",
      "BTC",
      "Bitcoin",
      "crypto",
      createdAt,
      createdAt,
    );
  database.sqlite
    .query(
      `
        insert into transactions (
          id,
          account_id,
          source_sync_run_id,
          provider_transaction_id,
          posted_at,
          description,
          amount_minor,
          direction
        )
        values (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      "txn_1",
      "acct_cash",
      "sync_plaid_success",
      "provider-txn-1",
      createdAt,
      "Payroll",
      100_00,
      "credit",
    );
  database.sqlite
    .query(
      `
        insert into investment_transactions (
          id,
          account_id,
          source_sync_run_id,
          provider_transaction_id,
          posted_at,
          type,
          name,
          amount_minor,
          quantity
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      "investment_txn_1",
      "acct_investment",
      "sync_coinbase_success",
      "coinbase-txn-1",
      createdAt,
      "buy",
      "Buy BTC",
      500_00,
      "0.01",
    );
}

describe("CLI sync status", () => {
  test("summarizes connection health, latest runs, stale state, and local records", async () => {
    const { cleanup, database } = await makeDatabase();

    try {
      const summary = await getVistaStatusSummary(
        database,
        new Date("2026-05-30T12:00:00.000Z"),
      );

      expect(summary.activeConnectionCount).toBe(3);
      expect(summary.connectionCount).toBe(3);
      expect(summary.latestSync?.runId).toBe("sync_plaid_failed");
      expect(summary.latestSync?.status).toBe("failed");
      expect(summary.lastSuccessfulSync?.runId).toBe("sync_plaid_success");
      expect(summary.lastFailedSync?.errorSummary).toBe("rate limited");
      expect(summary.neverSyncedActiveConnectionCount).toBe(1);
      expect(summary.staleActiveConnectionCount).toBe(1);
      expect(summary.recordCounts).toEqual({
        accounts: 2,
        bankTransactions: 1,
        holdings: 1,
        investmentTransactions: 1,
      });
    } finally {
      database.close();
      cleanup();
    }
  });

  test("lists sync runs with provider, connection, status, records, and errors", async () => {
    const { cleanup, database } = await makeDatabase();

    try {
      const runs = await listSyncRuns(database, { limit: 2 });

      expect(runs).toEqual([
        expect.objectContaining({
          errorSummary: "rate limited",
          institutionName: "Chase",
          provider: "plaid",
          recordsChanged: 0,
          runId: "sync_plaid_failed",
          status: "failed",
        }),
        expect.objectContaining({
          institutionName: "Chase",
          provider: "plaid",
          recordsChanged: 4,
          runId: "sync_plaid_success",
          status: "succeeded",
        }),
      ]);
    } finally {
      database.close();
      cleanup();
    }
  });

  test("shows one sync run by id", async () => {
    const { cleanup, database } = await makeDatabase();

    try {
      const run = await getSyncRun(database, "sync_coinbase_success");

      expect(run).toEqual(
        expect.objectContaining({
          institutionName: "Coinbase",
          provider: "coinbase",
          recordsChanged: 3,
          runId: "sync_coinbase_success",
          status: "succeeded",
        }),
      );
    } finally {
      database.close();
      cleanup();
    }
  });

  test("errors clearly for an unknown sync run id", async () => {
    const { cleanup, database } = await makeDatabase();

    try {
      await expect(getSyncRun(database, "missing_run")).rejects.toThrow(
        "Sync run not found: missing_run",
      );
    } finally {
      database.close();
      cleanup();
    }
  });

  test("validates sync runs limit", () => {
    expect(parseSyncRunsArgs([])).toEqual({ limit: 20 });
    expect(parseSyncRunsArgs(["--limit", "2"])).toEqual({ limit: 2 });
    expect(() => parseSyncRunsArgs(["--limit", "0"])).toThrow(
      "Sync runs limit must be an integer between 1 and 100.",
    );
    expect(() => parseSyncRunsArgs(["--limit", "abc"])).toThrow(
      "Sync runs limit must be an integer between 1 and 100.",
    );
  });
});
