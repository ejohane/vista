import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type LocalD1Database, openLocalD1Database } from "./local-d1";
import { ensureLocalSchema } from "./schema";
import {
  listTransactions,
  parseTransactionArgs,
  resolveTransactionListOptions,
  setBankTransactionReportingOverride,
  showTransaction,
  transactionShortId,
} from "./transactions";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "vista-transactions-test-"));
  tempDirs.push(dir);
  return dir;
}

function timestamp(date: string) {
  return new Date(`${date}T00:00:00.000Z`).getTime();
}

async function seedDatabase(database: LocalD1Database) {
  await database
    .prepare(
      `
        insert into households (id, name, last_synced_at, created_at)
        values (?, ?, ?, ?)
      `,
    )
    .bind("household_demo", "Vista Household", 0, 0)
    .run();

  await database
    .prepare(
      `
        insert into sync_runs (
          id,
          household_id,
          provider,
          status,
          trigger,
          started_at,
          completed_at,
          records_changed
        )
        values (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind("sync_1", "household_demo", "plaid", "succeeded", "seed", 0, 1, 0)
    .run();

  for (const account of [
    {
      displayName: "Primary Checking",
      id: "acct_checking",
      institutionName: "Local Bank",
      name: "Checking",
      reportingGroup: "cash",
      type: "checking",
    },
    {
      displayName: null,
      id: "acct_savings_1",
      institutionName: "Local Bank",
      name: "Ambiguous",
      reportingGroup: "cash",
      type: "savings",
    },
    {
      displayName: null,
      id: "acct_savings_2",
      institutionName: "Other Bank",
      name: "Ambiguous",
      reportingGroup: "cash",
      type: "savings",
    },
    {
      displayName: "Brokerage",
      id: "acct_brokerage",
      institutionName: "Broker",
      name: "Taxable",
      reportingGroup: "investments",
      type: "brokerage",
    },
  ] as const) {
    await database
      .prepare(
        `
          insert into accounts (
            id,
            household_id,
            name,
            display_name,
            institution_name,
            account_type,
            reporting_group,
            balance_minor,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        account.id,
        "household_demo",
        account.name,
        account.displayName,
        account.institutionName,
        account.type,
        account.reportingGroup,
        0,
        0,
        0,
      )
      .run();
  }

  await database
    .prepare(
      `
        insert into securities (
          id,
          provider,
          provider_security_id,
          symbol,
          name,
          price_source,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      "security_vti",
      "plaid",
      "provider_vti",
      "VTI",
      "Vanguard Total Stock Market ETF",
      "plaid_holdings",
      0,
      0,
    )
    .run();

  for (const transaction of [
    {
      accountId: "acct_checking",
      amountMinor: 525,
      categoryNormalized: "food",
      categoryRaw: "Food and Drink",
      description: "Coffee Shop",
      direction: "debit",
      id: "txn:bank:coffee",
      merchantName: "Coffee Shop",
      postedAt: timestamp("2026-05-10"),
      providerTransactionId: "provider-bank-coffee",
    },
    {
      accountId: "acct_savings_1",
      amountMinor: 100_000,
      categoryNormalized: "income",
      categoryRaw: "Payroll",
      description: "Payroll",
      direction: "credit",
      id: "txn:bank:payroll",
      merchantName: "Employer",
      postedAt: timestamp("2026-04-01"),
      providerTransactionId: "provider-bank-payroll",
    },
  ] as const) {
    await database
      .prepare(
        `
          insert into transactions (
            id,
            account_id,
            source_sync_run_id,
            provider_transaction_id,
            posted_at,
            description,
            merchant_name,
            amount_minor,
            direction,
            category_raw,
            category_normalized
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        transaction.id,
        transaction.accountId,
        "sync_1",
        transaction.providerTransactionId,
        transaction.postedAt,
        transaction.description,
        transaction.merchantName,
        transaction.amountMinor,
        transaction.direction,
        transaction.categoryRaw,
        transaction.categoryNormalized,
      )
      .run();
  }

  await database
    .prepare(
      `
        insert into investment_transactions (
          id,
          account_id,
          source_sync_run_id,
          provider_transaction_id,
          posted_at,
          trade_at,
          type,
          subtype,
          name,
          amount_minor,
          fees_minor,
          price_minor,
          quantity,
          security_id
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      "invtxn:buy-vti",
      "acct_brokerage",
      "sync_1",
      "provider-investment-vti",
      timestamp("2026-05-11"),
      timestamp("2026-05-10"),
      "buy",
      "buy",
      "Bought VTI",
      120_000,
      0,
      20_000,
      "6",
      "security_vti",
    )
    .run();
}

async function makeDatabase() {
  const database = openLocalD1Database(join(makeTempDir(), "vista.sqlite"));
  await ensureLocalSchema(database);
  await seedDatabase(database);
  return database;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("transactions CLI", () => {
  test("parses compatible list options and filters", () => {
    expect(parseTransactionArgs(["--limit", "10"])).toEqual({
      json: false,
      limit: 10,
      mode: "list",
    });
    expect(
      parseTransactionArgs([
        "--limit",
        "5",
        "--account",
        "acct_checking",
        "--since",
        "2026-05-01",
        "--until",
        "2026-05-31",
        "--kind",
        "bank",
      ]),
    ).toEqual({
      account: "acct_checking",
      json: false,
      kind: "bank",
      limit: 5,
      mode: "list",
      since: "2026-05-01",
      until: "2026-05-31",
    });
  });

  test("validates limit, kind, and dates", () => {
    expect(() => parseTransactionArgs(["--limit", "0"])).toThrow(
      "--limit must be a positive integer.",
    );
    expect(() => parseTransactionArgs(["--kind", "cash"])).toThrow(
      "--kind must be bank or investment.",
    );
    expect(() => parseTransactionArgs(["--since", "2026-13-01"])).toThrow(
      "--since must be a valid YYYY-MM-DD date.",
    );
    expect(() =>
      parseTransactionArgs(["--since", "2026-06-01", "--until", "2026-05-01"]),
    ).toThrow("--since must be on or before --until.");
  });

  test("combines kind, date, and account filters", async () => {
    const database = await makeDatabase();

    try {
      const options = await resolveTransactionListOptions(database, {
        account: "acct_checking",
        json: false,
        kind: "bank",
        limit: 10,
        mode: "list",
        since: "2026-05-01",
        until: "2026-05-31",
      });
      const transactions = await listTransactions(database, options);

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toMatchObject({
        accountId: "acct_checking",
        description: "Coffee Shop",
        id: "txn:bank:coffee",
        kind: "bank",
      });
      expect(transactionShortId("bank", transactions[0].id)).toStartWith(
        "bank-",
      );
    } finally {
      database.close();
    }
  });

  test("resolves account names safely and rejects ambiguous matches", async () => {
    const database = await makeDatabase();

    try {
      const options = await resolveTransactionListOptions(database, {
        account: "Primary Checking",
        json: false,
        limit: 10,
        mode: "list",
      });

      expect(options.accountId).toBe("acct_checking");
      await expect(
        resolveTransactionListOptions(database, {
          account: "Ambiguous",
          json: false,
          limit: 10,
          mode: "list",
        }),
      ).rejects.toThrow("--account Ambiguous is ambiguous.");
    } finally {
      database.close();
    }
  });

  test("shows bank and investment transaction details", async () => {
    const database = await makeDatabase();

    try {
      const bankShortId = transactionShortId("bank", "txn:bank:coffee");
      await expect(
        showTransaction(database, bankShortId),
      ).resolves.toMatchObject({
        accountName: "Primary Checking",
        description: "Coffee Shop",
        excludedFromReporting: 0,
        kind: "bank",
      });

      await expect(
        showTransaction(database, "provider-investment-vti"),
      ).resolves.toMatchObject({
        kind: "investment",
        name: "Bought VTI",
        symbol: "VTI",
        type: "buy",
      });
    } finally {
      database.close();
    }
  });

  test("errors clearly for an unknown transaction id", async () => {
    const database = await makeDatabase();

    try {
      await expect(showTransaction(database, "missing-id")).rejects.toThrow(
        "No transaction found for id missing-id.",
      );
    } finally {
      database.close();
    }
  });

  test("excludes and includes bank transactions", async () => {
    const database = await makeDatabase();

    try {
      await expect(
        setBankTransactionReportingOverride(database, "txn:bank:coffee", true),
      ).resolves.toMatchObject({
        excludedFromReporting: 1,
        kind: "bank",
      });
      await expect(
        setBankTransactionReportingOverride(database, "txn:bank:coffee", false),
      ).resolves.toMatchObject({
        excludedFromReporting: 0,
        kind: "bank",
      });
    } finally {
      database.close();
    }
  });

  test("rejects reporting overrides for investment transactions", async () => {
    const database = await makeDatabase();

    try {
      await expect(
        setBankTransactionReportingOverride(database, "invtxn:buy-vti", true),
      ).rejects.toThrow(
        "Investment transactions do not support reporting overrides.",
      );
    } finally {
      database.close();
    }
  });
});
