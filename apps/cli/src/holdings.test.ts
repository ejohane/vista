import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  classifyHolding,
  getHolding,
  listHoldings,
  parseHoldingsArgs,
} from "./holdings";
import { type LocalD1Database, openLocalD1Database } from "./local-d1";
import { ensureLocalSchema } from "./schema";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "vista-holdings-test-"));
  tempDirs.push(dir);
  return dir;
}

async function makeDatabase() {
  const database = openLocalD1Database(join(makeTempDir(), "vista.sqlite"));
  await ensureLocalSchema(database);

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
      "household_default",
      "Brokerage",
      "Broker",
      "brokerage",
      "investments",
      12_345_00,
      now,
      now,
    );

  database.sqlite
    .query(
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
    .run(
      "sync_1",
      "household_default",
      "plaid",
      "succeeded",
      "scheduled",
      now,
      now,
      1,
    );

  return database;
}

function insertHolding(
  database: LocalD1Database,
  options: {
    assetClass?: string;
    holdingId: string;
    marketValueMinor?: number;
    name?: string;
    symbol: string;
  },
) {
  const now = Date.parse("2026-05-30T12:30:00.000Z");

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
          currency,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          symbol = excluded.symbol,
          name = excluded.name,
          asset_class = excluded.asset_class,
          updated_at = excluded.updated_at
      `,
    )
    .run(
      options.holdingId,
      "acct_brokerage",
      `security:${options.holdingId}`,
      options.symbol,
      options.name ?? `${options.symbol} Holding`,
      options.assetClass ?? "equity",
      "USD",
      now,
      now,
    );

  database.sqlite
    .query(
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
        on conflict(holding_id, source_sync_run_id) do update set
          captured_at = excluded.captured_at,
          quantity = excluded.quantity,
          price_minor = excluded.price_minor,
          market_value_minor = excluded.market_value_minor,
          cost_basis_minor = excluded.cost_basis_minor
      `,
    )
    .run(
      `snapshot:${options.holdingId}`,
      options.holdingId,
      "acct_brokerage",
      "sync_1",
      now,
      "2026-05-30",
      "3.5",
      10_000,
      options.marketValueMinor ?? 35_000,
      30_000,
    );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("holdings CLI", () => {
  test("lists holdings with stable ids", async () => {
    const database = await makeDatabase();

    try {
      insertHolding(database, {
        holdingId: "holding_vti_1",
        symbol: "VTI",
      });

      const holdings = await listHoldings(database);

      expect(holdings).toMatchObject([
        {
          id: "holding_vti_1",
          symbol: "VTI",
        },
      ]);
    } finally {
      database.close();
    }
  });

  test("shows holding metadata by id", async () => {
    const database = await makeDatabase();

    try {
      insertHolding(database, {
        holdingId: "holding_vti_1",
        name: "Vanguard Total Stock Market ETF",
        symbol: "VTI",
      });

      const holding = await getHolding(database, "holding_vti_1");

      expect(holding).toMatchObject({
        accountId: "acct_brokerage",
        accountName: "Brokerage",
        assetClass: "equity",
        holdingId: "holding_vti_1",
        marketValueMinor: 35_000,
        name: "Vanguard Total Stock Market ETF",
        overrideAssetClass: null,
        providerAssetClass: "equity",
        quantity: "3.5",
        symbol: "VTI",
      });
      expect(holding.updatedAt).toBeGreaterThan(0);
      expect(holding.snapshotCapturedAt).toBeGreaterThan(0);
    } finally {
      database.close();
    }
  });

  test("classifies a holding by id", async () => {
    const database = await makeDatabase();

    try {
      insertHolding(database, {
        holdingId: "holding_vti_1",
        symbol: "VTI",
      });

      const holding = await classifyHolding(database, "holding_vti_1", "fund");

      expect(holding.assetClass).toBe("fund");
      expect(holding.overrideAssetClass).toBe("fund");
      expect(holding.providerAssetClass).toBe("equity");
    } finally {
      database.close();
    }
  });

  test("requires holding id when a symbol is ambiguous", async () => {
    const database = await makeDatabase();

    try {
      insertHolding(database, {
        holdingId: "holding_vti_1",
        symbol: "VTI",
      });
      insertHolding(database, {
        holdingId: "holding_vti_2",
        marketValueMinor: 20_000,
        symbol: "VTI",
      });

      await expect(classifyHolding(database, "VTI", "fund")).rejects.toThrow(
        /holding_vti_1[\s\S]*holding_vti_2/,
      );

      const overrides = database.sqlite
        .query("select count(*) as count from holding_classification_overrides")
        .get() as { count: number };

      expect(overrides.count).toBe(0);
    } finally {
      database.close();
    }
  });

  test("rejects invalid asset classes", () => {
    expect(() =>
      parseHoldingsArgs([
        "classify",
        "holding_vti_1",
        "--asset-class",
        "us_equity",
      ]),
    ).toThrow(/cash, equity, fixed_income, crypto, fund, other/);
  });

  test("rejects unknown holdings", async () => {
    const database = await makeDatabase();

    try {
      await expect(getHolding(database, "missing_holding")).rejects.toThrow(
        "Holding missing_holding could not be found.",
      );
    } finally {
      database.close();
    }
  });

  test("keeps local classification overrides across provider upserts", async () => {
    const database = await makeDatabase();

    try {
      insertHolding(database, {
        assetClass: "equity",
        holdingId: "holding_vti_1",
        symbol: "VTI",
      });

      await classifyHolding(database, "holding_vti_1", "fund");

      insertHolding(database, {
        assetClass: "crypto",
        holdingId: "holding_vti_1",
        symbol: "VTI",
      });

      const holding = await getHolding(database, "holding_vti_1");

      expect(holding.assetClass).toBe("fund");
      expect(holding.overrideAssetClass).toBe("fund");
      expect(holding.providerAssetClass).toBe("crypto");
    } finally {
      database.close();
    }
  });
});
