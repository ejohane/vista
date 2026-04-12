import { describe, expect, test } from "bun:test";

import {
  createAlphaVantagePriceClient,
  importSecurityPriceHistory,
  refreshHistoricalNetWorthForHousehold,
} from "./backfilled-net-worth";
import { createEmptySyncDatabase } from "./test-helpers";

describe("importSecurityPriceHistory", () => {
  test("stores bounded daily prices idempotently and marks missing weekdays", async () => {
    const { d1, sqlite } = createEmptySyncDatabase();
    const createdAt = new Date("2026-04-11T12:00:00.000Z").getTime();

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
        "Brokerage",
        "Vanguard",
        "brokerage",
        "investments",
        0,
        createdAt,
        createdAt,
      );

    sqlite
      .query(
        `
          insert into securities (
            id,
            provider,
            provider_security_id,
            symbol,
            name,
            security_type,
            security_subtype,
            currency,
            price_source,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "security:plaid:security-vti",
        "plaid",
        "security-vti",
        "VTI",
        "Vanguard Total Stock Market ETF",
        "etf",
        "large_cap",
        "USD",
        "alpha_vantage",
        createdAt,
        createdAt,
      );
    sqlite
      .query(
        `
          insert into holdings (
            id,
            account_id,
            holding_key,
            symbol,
            name,
            security_id,
            asset_class,
            sub_asset_class,
            currency,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "holding_vti",
        "acct_brokerage",
        "holding-key-vti",
        "VTI",
        "Vanguard Total Stock Market ETF",
        "security:plaid:security-vti",
        "fund",
        "etf",
        "USD",
        createdAt,
        createdAt,
      );

    const firstResult = await importSecurityPriceHistory({
      database: d1,
      endDate: "2026-04-10",
      now: new Date("2026-04-11T12:00:00.000Z"),
      priceClient: {
        fetchDailyPrices: async () => [
          { closePriceMinor: 27432, priceDate: "2026-04-08" },
          { closePriceMinor: 27611, priceDate: "2026-04-10" },
        ],
      },
      startDate: "2026-04-08",
    });

    const secondResult = await importSecurityPriceHistory({
      database: d1,
      endDate: "2026-04-10",
      now: new Date("2026-04-11T12:05:00.000Z"),
      priceClient: {
        fetchDailyPrices: async () => [
          { closePriceMinor: 27432, priceDate: "2026-04-08" },
          { closePriceMinor: 27611, priceDate: "2026-04-10" },
        ],
      },
      startDate: "2026-04-08",
    });

    expect(firstResult).toEqual({
      importedPriceCount: 2,
      missingPriceCount: 1,
    });
    expect(secondResult).toEqual({
      importedPriceCount: 2,
      missingPriceCount: 1,
    });
    expect(
      sqlite.query("select count(*) as count from security_price_daily").get(),
    ).toEqual({ count: 3 });
    expect(
      sqlite
        .query(
          `
            select
              price_date as priceDate,
              close_price_minor as closePriceMinor,
              source,
              is_estimated as isEstimated
            from security_price_daily
            where security_id = ?
            order by price_date asc
          `,
        )
        .all("security:plaid:security-vti"),
    ).toEqual([
      {
        closePriceMinor: 27432,
        isEstimated: 0,
        priceDate: "2026-04-08",
        source: "alpha_vantage",
      },
      {
        closePriceMinor: null,
        isEstimated: 1,
        priceDate: "2026-04-09",
        source: "missing",
      },
      {
        closePriceMinor: 27611,
        isEstimated: 0,
        priceDate: "2026-04-10",
        source: "alpha_vantage",
      },
    ]);
  });

  test("parses Alpha Vantage daily series and filters the requested date range", async () => {
    const requestUrls: string[] = [];
    const client = createAlphaVantagePriceClient({
      apiKey: "alpha-demo",
      fetchFn: async (input) => {
        requestUrls.push(String(input));

        return new Response(
          JSON.stringify({
            "Time Series (Daily)": {
              "2026-04-10": {
                "4. close": "276.11",
                "5. adjusted close": "276.11",
              },
              "2026-04-09": {
                "4. close": "274.20",
                "5. adjusted close": "274.20",
              },
              "2026-04-08": {
                "4. close": "272.01",
                "5. adjusted close": "272.01",
              },
            },
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        );
      },
    });

    const prices = await client.fetchDailyPrices({
      endDate: "2026-04-10",
      security: {
        id: "security:plaid:security-vti",
        name: "Vanguard Total Stock Market ETF",
        priceSource: "alpha_vantage",
        securitySubtype: "etf",
        securityType: "etf",
        symbol: "VTI",
      },
      startDate: "2026-04-09",
    });

    expect(prices).toEqual([
      { closePriceMinor: 27611, priceDate: "2026-04-10" },
      { closePriceMinor: 27420, priceDate: "2026-04-09" },
    ]);
    expect(requestUrls).toHaveLength(1);
    expect(requestUrls[0]).toContain("function=TIME_SERIES_DAILY_ADJUSTED");
    expect(requestUrls[0]).toContain("outputsize=full");
    expect(requestUrls[0]).toContain("symbol=VTI");
  });

  test("rebuilds only the requested household and imports prices only for that household", async () => {
    const { d1, sqlite } = createEmptySyncDatabase();
    const createdAt = new Date("2026-04-11T12:00:00.000Z").getTime();

    const seedHousehold = (values: {
      accountId: string;
      holdingId: string;
      householdId: string;
      runId: string;
      securityId: string;
      securityName: string;
      securitySymbol: string;
    }) => {
      sqlite
        .query(
          `
            insert into households (id, name, last_synced_at, created_at)
            values (?, ?, ?, ?)
          `,
        )
        .run(
          values.householdId,
          `Household ${values.householdId}`,
          createdAt,
          createdAt,
        );
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
          values.accountId,
          values.householdId,
          "Brokerage",
          "Vanguard",
          "brokerage",
          "investments",
          276110,
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
          values.runId,
          values.householdId,
          "plaid",
          "succeeded",
          "scheduled",
          4,
          createdAt,
          createdAt,
        );
      sqlite
        .query(
          `
            insert into securities (
              id,
              provider,
              provider_security_id,
              symbol,
              name,
              security_type,
              security_subtype,
              currency,
              price_source,
              created_at,
              updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          values.securityId,
          "plaid",
          values.securityId.replace("security:plaid:", ""),
          values.securitySymbol,
          values.securityName,
          "etf",
          "etf",
          "USD",
          "alpha_vantage",
          createdAt,
          createdAt,
        );
      sqlite
        .query(
          `
            insert into holdings (
              id,
              account_id,
              holding_key,
              symbol,
              name,
              security_id,
              asset_class,
              sub_asset_class,
              currency,
              created_at,
              updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          values.holdingId,
          values.accountId,
          `holding-key-${values.holdingId}`,
          values.securitySymbol,
          values.securityName,
          values.securityId,
          "fund",
          "etf",
          "USD",
          createdAt,
          createdAt,
        );
      sqlite
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
          `,
        )
        .run(
          `holding-snapshot-${values.holdingId}`,
          values.holdingId,
          values.accountId,
          values.runId,
          createdAt,
          "2026-04-10",
          "10",
          27611,
          276110,
          250000,
        );
      sqlite
        .query(
          `
            insert into investment_transactions (
              id,
              account_id,
              provider_transaction_id,
              posted_at,
              trade_at,
              amount_minor,
              price_minor,
              fees_minor,
              quantity,
              name,
              security_id,
              type,
              subtype,
              currency,
              source_sync_run_id
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          `invtxn-${values.accountId}`,
          values.accountId,
          `provider-invtxn-${values.accountId}`,
          Date.parse("2026-04-08T15:00:00.000Z"),
          Date.parse("2026-04-08T15:00:00.000Z"),
          27432,
          27432,
          null,
          "1",
          `BUY ${values.securityName}`,
          values.securityId,
          "buy",
          "buy",
          "USD",
          values.runId,
        );
    };

    seedHousehold({
      accountId: "acct_household_a",
      holdingId: "holding_household_a",
      householdId: "household_a",
      runId: "sync_household_a",
      securityId: "security:plaid:security-vti-a",
      securityName: "Vanguard ETF A",
      securitySymbol: "VTIA",
    });
    seedHousehold({
      accountId: "acct_household_b",
      holdingId: "holding_household_b",
      householdId: "household_b",
      runId: "sync_household_b",
      securityId: "security:plaid:security-vti-b",
      securityName: "Vanguard ETF B",
      securitySymbol: "VTIB",
    });

    const result = await refreshHistoricalNetWorthForHousehold({
      database: d1,
      householdId: "household_a",
      now: new Date("2026-04-11T12:00:00.000Z"),
      priceClient: {
        fetchDailyPrices: async ({ security }) => [
          {
            closePriceMinor: security.symbol === "VTIA" ? 27432 : 19999,
            priceDate: "2026-04-08",
          },
          {
            closePriceMinor: security.symbol === "VTIA" ? 27510 : 20010,
            priceDate: "2026-04-09",
          },
          {
            closePriceMinor: security.symbol === "VTIA" ? 27611 : 20020,
            priceDate: "2026-04-10",
          },
        ],
      },
    });

    expect(result).toEqual({
      accountValueFactCount: 3,
      importedPriceCount: 3,
      missingPriceCount: 0,
      netWorthFactCount: 3,
      positionFactCount: 3,
      rebuiltHouseholdCount: 1,
    });
    expect(
      sqlite
        .query(
          `
            select count(*) as count
            from security_price_daily
            where security_id = ?
          `,
        )
        .get("security:plaid:security-vti-a"),
    ).toEqual({ count: 3 });
    expect(
      sqlite
        .query(
          `
            select count(*) as count
            from security_price_daily
            where security_id = ?
          `,
        )
        .get("security:plaid:security-vti-b"),
    ).toEqual({ count: 0 });
    expect(
      sqlite
        .query(
          `
            select count(*) as count
            from daily_net_worth_facts
            where household_id = ?
          `,
        )
        .get("household_a"),
    ).toEqual({ count: 3 });
    expect(
      sqlite
        .query(
          `
            select count(*) as count
            from daily_net_worth_facts
            where household_id = ?
          `,
        )
        .get("household_b"),
    ).toEqual({ count: 0 });
  });

  test("uses posted_at when trade_at is missing so live Plaid rows still backfill multiple days", async () => {
    const { d1, sqlite } = createEmptySyncDatabase();
    const createdAt = new Date("2026-04-11T12:00:00.000Z").getTime();

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
        "Brokerage",
        "Vanguard",
        "brokerage",
        "investments",
        276110,
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
        "sync_household_demo",
        "household_demo",
        "plaid",
        "succeeded",
        "scheduled",
        4,
        createdAt,
        createdAt,
      );
    sqlite
      .query(
        `
          insert into securities (
            id,
            provider,
            provider_security_id,
            symbol,
            name,
            security_type,
            security_subtype,
            currency,
            price_source,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "security:plaid:security-vti",
        "plaid",
        "security-vti",
        "VTI",
        "Vanguard Total Stock Market ETF",
        "etf",
        "etf",
        "USD",
        "alpha_vantage",
        createdAt,
        createdAt,
      );
    sqlite
      .query(
        `
          insert into holdings (
            id,
            account_id,
            holding_key,
            symbol,
            name,
            security_id,
            asset_class,
            sub_asset_class,
            currency,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "holding_vti",
        "acct_brokerage",
        "holding-key-vti",
        "VTI",
        "Vanguard Total Stock Market ETF",
        "security:plaid:security-vti",
        "fund",
        "etf",
        "USD",
        createdAt,
        createdAt,
      );
    sqlite
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
        `,
      )
      .run(
        "holding-snapshot-vti",
        "holding_vti",
        "acct_brokerage",
        "sync_household_demo",
        createdAt,
        "2026-04-10",
        "10",
        27611,
        276110,
        250000,
      );
    sqlite
      .query(
        `
          insert into investment_transactions (
            id,
            account_id,
            provider_transaction_id,
            posted_at,
            trade_at,
            amount_minor,
            price_minor,
            fees_minor,
            quantity,
            name,
            security_id,
            type,
            subtype,
            currency,
            source_sync_run_id
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "invtxn-acct-brokerage",
        "acct_brokerage",
        "provider-invtxn-acct-brokerage",
        Date.parse("2026-04-08T15:00:00.000Z"),
        null,
        27432,
        27432,
        null,
        "1",
        "BUY Vanguard Total Stock Market ETF",
        "security:plaid:security-vti",
        "buy",
        "buy",
        "USD",
        "sync_household_demo",
      );

    const result = await refreshHistoricalNetWorthForHousehold({
      database: d1,
      householdId: "household_demo",
      now: new Date("2026-04-11T12:00:00.000Z"),
      priceClient: {
        fetchDailyPrices: async () => [
          {
            closePriceMinor: 27432,
            priceDate: "2026-04-08",
          },
          {
            closePriceMinor: 27510,
            priceDate: "2026-04-09",
          },
          {
            closePriceMinor: 27611,
            priceDate: "2026-04-10",
          },
        ],
      },
    });

    expect(result.netWorthFactCount).toBe(3);
    expect(
      sqlite
        .query(
          `
            select fact_date as factDate
            from daily_net_worth_facts
            order by fact_date asc
          `,
        )
        .all(),
    ).toEqual([
      { factDate: "2026-04-08" },
      { factDate: "2026-04-09" },
      { factDate: "2026-04-10" },
    ]);
  });
});
