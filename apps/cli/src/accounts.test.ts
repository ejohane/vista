import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getAccount,
  listAccounts,
  parseAccountsArgs,
  printAccountDetail,
  printAccounts,
  renameAccount,
  setAccountHidden,
  setAccountIncluded,
  setAccountOwner,
} from "./accounts";
import { getDashboardSummary } from "./dashboard";
import { type LocalD1Database, openLocalD1Database } from "./local-d1";
import { ensureLocalSchema } from "./schema";

function createTempDatabasePath() {
  const dir = mkdtempSync(join(tmpdir(), "vista-accounts-test-"));

  return {
    cleanup: () => rmSync(dir, { force: true, recursive: true }),
    path: join(dir, "vista.sqlite"),
  };
}

async function makeDatabase() {
  const temp = createTempDatabasePath();
  const database = openLocalD1Database(temp.path);

  await ensureLocalSchema(database);
  insertFixture(database);

  return {
    cleanup: temp.cleanup,
    database,
  };
}

function insertFixture(database: LocalD1Database) {
  const now = Date.parse("2026-05-30T12:00:00.000Z");

  database.sqlite
    .query(
      `
        insert into households (id, name, last_synced_at, created_at)
        values (?, ?, ?, ?)
      `,
    )
    .run("household_default", "Vista Household", now, now);

  database.sqlite
    .query(
      `
        insert into provider_connections (
          id,
          household_id,
          provider,
          status,
          external_connection_id,
          institution_id,
          institution_name,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      "conn:plaid:item-1",
      "household_default",
      "plaid",
      "active",
      "item-1",
      "ins_1",
      "Test Bank",
      now,
      now,
    );

  database.sqlite
    .query(
      `
        insert into provider_accounts (
          id,
          provider_connection_id,
          provider_account_id,
          name,
          institution_name,
          account_type,
          account_subtype,
          currency,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      "pa:checking",
      "conn:plaid:item-1",
      "checking-native",
      "Checking",
      "Test Bank",
      "checking",
      "checking",
      "USD",
      now,
      now,
    );

  database.sqlite
    .query(
      `
        insert into accounts (
          id,
          household_id,
          provider_account_id,
          name,
          display_name,
          institution_name,
          account_type,
          account_subtype,
          reporting_group,
          ownership_type,
          include_in_household_reporting,
          is_hidden,
          balance_minor,
          currency,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      "acct_checking",
      "household_default",
      "pa:checking",
      "Checking",
      null,
      "Test Bank",
      "checking",
      "checking",
      "cash",
      "joint",
      1,
      0,
      125_00,
      "USD",
      now,
      now,
    );
}

function captureConsole(callback: () => void) {
  const originalLog = console.log;
  const lines: string[] = [];

  console.log = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };

  try {
    callback();
  } finally {
    console.log = originalLog;
  }

  return lines.join("\n");
}

describe("accounts CLI curation", () => {
  test("parses supported account curation commands", () => {
    expect(parseAccountsArgs([])).toEqual({ json: false, kind: "list" });
    expect(parseAccountsArgs(["--json"])).toEqual({
      json: true,
      kind: "list",
    });
    expect(parseAccountsArgs(["show", "acct_checking"])).toEqual({
      accountId: "acct_checking",
      kind: "show",
    });
    expect(parseAccountsArgs(["rename", "acct_checking", "Emergency"])).toEqual(
      {
        accountId: "acct_checking",
        displayName: "Emergency",
        kind: "rename",
      },
    );
    expect(parseAccountsArgs(["rename", "acct_checking", "--clear"])).toEqual({
      accountId: "acct_checking",
      displayName: null,
      kind: "rename",
    });
    expect(parseAccountsArgs(["hide", "acct_checking"])).toEqual({
      accountId: "acct_checking",
      hidden: true,
      kind: "visibility",
    });
    expect(parseAccountsArgs(["include", "acct_checking"])).toEqual({
      accountId: "acct_checking",
      included: true,
      kind: "inclusion",
    });
    expect(
      parseAccountsArgs(["owner", "acct_checking", "--owner", "mine"]),
    ).toEqual({
      accountId: "acct_checking",
      kind: "owner",
      ownershipType: "mine",
    });
  });

  test("shows account metadata including curation fields", async () => {
    const { cleanup, database } = await makeDatabase();

    try {
      const account = await getAccount(database, "acct_checking");
      const output = captureConsole(() => {
        if (!account) throw new Error("missing account");
        printAccountDetail(account);
      });

      expect(output).toContain("ID: acct_checking");
      expect(output).toContain("Display name: (not set)");
      expect(output).toContain("Included in household reporting: yes");
      expect(output).toContain("Hidden: no");
      expect(output).toContain("Ownership: joint");
      expect(output).toContain("Provider connection: conn:plaid:item-1");
      expect(output).toContain("Provider native account: checking-native");
    } finally {
      database.close();
      cleanup();
    }
  });

  test("renames accounts and clears display names explicitly", async () => {
    const { cleanup, database } = await makeDatabase();

    try {
      await renameAccount(database, "acct_checking", "  Emergency Fund  ");
      expect((await getAccount(database, "acct_checking"))?.displayName).toBe(
        "Emergency Fund",
      );

      await renameAccount(database, "acct_checking", null);
      expect((await getAccount(database, "acct_checking"))?.displayName).toBe(
        null,
      );
    } finally {
      database.close();
      cleanup();
    }
  });

  test("hides and unhides accounts consistently with dashboard totals and list flags", async () => {
    const { cleanup, database } = await makeDatabase();

    try {
      expect((await getDashboardSummary(database))?.cashMinor).toBe(125_00);

      await setAccountHidden(database, "acct_checking", true);
      expect((await getAccount(database, "acct_checking"))?.isHidden).toBe(1);
      expect((await getDashboardSummary(database))?.cashMinor).toBe(0);

      const hiddenAccounts = await listAccounts(database);
      const hiddenListOutput = captureConsole(() => {
        printAccounts(hiddenAccounts);
      });
      expect(hiddenListOutput).toContain("hidden");

      await setAccountHidden(database, "acct_checking", false);
      expect((await getAccount(database, "acct_checking"))?.isHidden).toBe(0);
      expect((await getDashboardSummary(database))?.cashMinor).toBe(125_00);
    } finally {
      database.close();
      cleanup();
    }
  });

  test("includes and excludes accounts consistently with dashboard totals", async () => {
    const { cleanup, database } = await makeDatabase();

    try {
      expect((await getDashboardSummary(database))?.cashMinor).toBe(125_00);

      await setAccountIncluded(database, "acct_checking", false);
      expect(
        (await getAccount(database, "acct_checking"))
          ?.includeInHouseholdReporting,
      ).toBe(0);
      expect((await getDashboardSummary(database))?.cashMinor).toBe(0);

      await setAccountIncluded(database, "acct_checking", true);
      expect(
        (await getAccount(database, "acct_checking"))
          ?.includeInHouseholdReporting,
      ).toBe(1);
      expect((await getDashboardSummary(database))?.cashMinor).toBe(125_00);
    } finally {
      database.close();
      cleanup();
    }
  });

  test("updates account ownership", async () => {
    const { cleanup, database } = await makeDatabase();

    try {
      await setAccountOwner(database, "acct_checking", "mine");

      expect((await getAccount(database, "acct_checking"))?.ownershipType).toBe(
        "mine",
      );
    } finally {
      database.close();
      cleanup();
    }
  });

  test("mutations error clearly for unknown account ids", async () => {
    const { cleanup, database } = await makeDatabase();

    try {
      await expect(
        setAccountIncluded(database, "acct_missing", false),
      ).rejects.toThrow("Account not found: acct_missing");
      expect((await getAccount(database, "acct_checking"))?.isHidden).toBe(0);
      expect(
        (await getAccount(database, "acct_checking"))
          ?.includeInHouseholdReporting,
      ).toBe(1);
    } finally {
      database.close();
      cleanup();
    }
  });

  test("existing account list behavior still returns imported accounts", async () => {
    const { cleanup, database } = await makeDatabase();

    try {
      expect(await listAccounts(database)).toMatchObject([
        {
          id: "acct_checking",
          name: "Checking",
          reportingGroup: "cash",
        },
      ]);
    } finally {
      database.close();
      cleanup();
    }
  });
});
