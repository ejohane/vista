import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

function createSchemaTestDatabase() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  applyMigrations(sqlite);
  return sqlite;
}

describe("schema foundation for Plaid-backed sync", () => {
  test("supports provider connections, provider accounts, and canonical account curation defaults", () => {
    const sqlite = createSchemaTestDatabase();
    const createdAt = new Date("2026-03-18T00:00:00.000Z").getTime();

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
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "conn_plaid_us_bank",
        "household_demo",
        "plaid",
        "active",
        "plaid-demo-connection",
        createdAt,
        createdAt,
      );

    sqlite
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
        "prov_acct_checking",
        "conn_plaid_us_bank",
        "plaid-account-123",
        "US Bank Platinum Checking",
        "US Bank",
        "checking",
        "checking",
        "USD",
        createdAt,
        createdAt,
      );

    sqlite
      .query(
        `
          insert into accounts (
            id,
            household_id,
            provider_account_id,
            name,
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
      .run(
        "acct_checking",
        "household_demo",
        "prov_acct_checking",
        "Everyday Checking",
        "US Bank",
        "checking",
        "cash",
        1284500,
        createdAt,
        createdAt,
      );

    expect(
      sqlite
        .query(
          `
            select
              provider_account_id as providerAccountId,
              display_name as displayName,
              account_subtype as accountSubtype,
              currency,
              ownership_type as ownershipType,
              include_in_household_reporting as includeInHouseholdReporting,
              is_hidden as isHidden
            from accounts
            where id = ?
          `,
        )
        .get("acct_checking"),
    ).toEqual({
      accountSubtype: null,
      currency: "USD",
      displayName: null,
      includeInHouseholdReporting: 1,
      isHidden: 0,
      ownershipType: "joint",
      providerAccountId: "prov_acct_checking",
    });
  });

  test("allows provider-backed credit-card accounts to land in liabilities", () => {
    const sqlite = createSchemaTestDatabase();
    const createdAt = new Date("2026-03-18T00:00:00.000Z").getTime();

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
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "conn_plaid_us_bank",
        "household_demo",
        "plaid",
        "active",
        "plaid-demo-connection",
        createdAt,
        createdAt,
      );

    sqlite
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
        "prov_acct_credit_card",
        "conn_plaid_us_bank",
        "plaid-account-cc-123",
        "Primary Credit Card",
        "US Bank",
        "credit_card",
        "credit_card",
        "USD",
        createdAt,
        createdAt,
      );

    sqlite
      .query(
        `
          insert into accounts (
            id,
            household_id,
            provider_account_id,
            name,
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
      .run(
        "acct_credit_card",
        "household_demo",
        "prov_acct_credit_card",
        "Primary Credit Card",
        "US Bank",
        "credit_card",
        "liabilities",
        -12345,
        createdAt,
        createdAt,
      );

    expect(
      sqlite
        .query(
          `
            select
              account_type as accountType,
              reporting_group as reportingGroup,
              balance_minor as balanceMinor
            from accounts
            where id = ?
          `,
        )
        .get("acct_credit_card"),
    ).toEqual({
      accountType: "credit_card",
      balanceMinor: -12345,
      reportingGroup: "liabilities",
    });
  });

  test("supports Plaid-backed liability account types", () => {
    const sqlite = createSchemaTestDatabase();
    const createdAt = new Date("2026-03-18T00:00:00.000Z").getTime();

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
            access_token,
            plaid_item_id,
            institution_name,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "conn_plaid_vanguard",
        "household_demo",
        "plaid",
        "active",
        "item-vanguard-1",
        "access-vanguard-1",
        "item-vanguard-1",
        "Vanguard",
        createdAt,
        createdAt,
      );
    sqlite
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
        "prov_acct_mortgage",
        "conn_plaid_vanguard",
        "plaid-account-123",
        "Primary Mortgage",
        "Vanguard",
        "mortgage",
        "mortgage",
        "USD",
        createdAt,
        createdAt,
      );
    sqlite
      .query(
        `
          insert into accounts (
            id,
            household_id,
            provider_account_id,
            name,
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
      .run(
        "acct_mortgage",
        "household_demo",
        "prov_acct_mortgage",
        "Primary Mortgage",
        "Vanguard",
        "mortgage",
        "liabilities",
        -42500000,
        createdAt,
        createdAt,
      );

    expect(
      sqlite
        .query(
          `
            select
              provider_connections.provider as provider,
              provider_connections.access_token as accessToken,
              accounts.account_type as accountType,
              accounts.reporting_group as reportingGroup
            from provider_connections
            join provider_accounts on provider_accounts.provider_connection_id = provider_connections.id
            join accounts on accounts.provider_account_id = provider_accounts.id
            where accounts.id = ?
          `,
        )
        .get("acct_mortgage"),
    ).toEqual({
      accessToken: "access-vanguard-1",
      accountType: "mortgage",
      provider: "plaid",
      reportingGroup: "liabilities",
    });
  });

  test("stores provider-linked sync runs with error details", () => {
    const sqlite = createSchemaTestDatabase();
    const createdAt = new Date("2026-03-18T00:00:00.000Z").getTime();

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
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "conn_plaid_us_bank",
        "household_demo",
        "plaid",
        "active",
        "plaid-demo-connection",
        createdAt,
        createdAt,
      );
    sqlite
      .query(
        `
          insert into provider_accounts (
            id,
            provider_connection_id,
            provider_account_id,
            name,
            institution_name,
            account_type,
            currency,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "prov_acct_checking",
        "conn_plaid_us_bank",
        "plaid-account-123",
        "US Bank Platinum Checking",
        "US Bank",
        "checking",
        "USD",
        createdAt,
        createdAt,
      );
    sqlite
      .query(
        `
          insert into accounts (
            id,
            household_id,
            provider_account_id,
            name,
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
      .run(
        "acct_checking",
        "household_demo",
        "prov_acct_checking",
        "Everyday Checking",
        "US Bank",
        "checking",
        "cash",
        1284500,
        createdAt,
        createdAt,
      );

    sqlite
      .query(
        `
          insert into sync_runs (
            id,
            household_id,
            provider_connection_id,
            provider,
            status,
            trigger,
            records_changed,
            error_summary,
            started_at,
            completed_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "sync_plaid_2026_03_18",
        "household_demo",
        "conn_plaid_us_bank",
        "plaid",
        "failed",
        "scheduled",
        3,
        "Plaid returned malformed account payload.",
        createdAt,
        createdAt,
      );

    expect(
      sqlite
        .query(
          `
            select
              provider_connection_id as providerConnectionId,
              provider,
              records_changed as recordsChanged,
              error_summary as errorSummary
            from sync_runs
            where id = ?
          `,
        )
        .get("sync_plaid_2026_03_18"),
    ).toEqual({
      errorSummary: "Plaid returned malformed account payload.",
      provider: "plaid",
      providerConnectionId: "conn_plaid_us_bank",
      recordsChanged: 3,
    });
  });

  test("stores canonical holdings and deduplicates holding snapshots by holding and sync run", () => {
    const sqlite = createSchemaTestDatabase();
    const createdAt = new Date("2026-03-18T00:00:00.000Z").getTime();

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
        "acct_brokerage",
        "household_demo",
        "Taxable Brokerage",
        "Vanguard",
        "brokerage",
        "investments",
        372012,
        createdAt,
        createdAt,
      );
    sqlite
      .query(
        `
          insert into sync_runs (
            id,
            household_id,
            provider,
            status,
            trigger,
            records_changed,
            started_at,
            completed_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "sync_plaid_1",
        "household_demo",
        "plaid",
        "succeeded",
        "scheduled",
        7,
        createdAt,
        createdAt,
      );

    const insertHolding = sqlite.query(
      `
        insert into holdings (
          id,
          account_id,
          holding_key,
          symbol,
          name,
          asset_class,
          sub_asset_class,
          currency,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    insertHolding.run(
      "holding_vti",
      "acct_brokerage",
      "symbol:vti",
      "VTI",
      "Vanguard Total Stock Market ETF",
      "equity",
      "ETF",
      "USD",
      createdAt,
      createdAt,
    );

    expect(() =>
      insertHolding.run(
        "holding_vti_duplicate",
        "acct_brokerage",
        "symbol:vti",
        "VTI",
        "Duplicate VTI",
        "equity",
        "ETF",
        "USD",
        createdAt,
        createdAt,
      ),
    ).toThrow();

    const insertSnapshot = sqlite.query(
      `
        insert into holding_snapshots (
          id,
          holding_id,
          account_id,
          source_sync_run_id,
          captured_at,
          as_of_date,
          quantity,
          price_minor,
          market_value_minor,
          cost_basis_minor
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    insertSnapshot.run(
      "holding_snapshot_vti_sync_1",
      "holding_vti",
      "acct_brokerage",
      "sync_plaid_1",
      createdAt,
      "2026-03-18",
      "10",
      30000,
      300000,
      250000,
    );

    expect(() =>
      insertSnapshot.run(
        "holding_snapshot_vti_sync_1_duplicate",
        "holding_vti",
        "acct_brokerage",
        "sync_plaid_1",
        createdAt,
        "2026-03-18",
        "10",
        30000,
        300000,
        250000,
      ),
    ).toThrow();

    expect(
      sqlite
        .query(
          `
            select
              holding_key as holdingKey,
              symbol,
              asset_class as assetClass,
              sub_asset_class as subAssetClass
            from holdings
            where id = ?
          `,
        )
        .get("holding_vti"),
    ).toEqual({
      assetClass: "equity",
      holdingKey: "symbol:vti",
      subAssetClass: "ETF",
      symbol: "VTI",
    });
  });
});
