import { printJson } from "./json-output";
import type { LocalD1Database } from "./local-d1";

export type HoldingRow = {
  accountName: string;
  assetClass: string;
  costBasisMinor: null | number;
  currency: string;
  marketValueMinor: number;
  name: string;
  priceMinor: null | number;
  quantity: string;
  symbol: null | string;
};

function formatUsd(minor: null | number) {
  if (minor === null) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(minor / 100);
}

function pad(value: string, length: number) {
  return value.padEnd(length, " ");
}

export async function listHoldings(database: LocalD1Database) {
  const rows = await database
    .prepare(
      `
        select
          coalesce(a.display_name, a.name) as accountName,
          h.symbol,
          h.name,
          h.asset_class as assetClass,
          h.currency,
          hs.quantity,
          hs.price_minor as priceMinor,
          hs.market_value_minor as marketValueMinor,
          hs.cost_basis_minor as costBasisMinor
        from holdings h
        join accounts a on a.id = h.account_id
        join holding_snapshots hs on hs.holding_id = h.id
        where hs.captured_at = (
          select max(inner_hs.captured_at)
          from holding_snapshots inner_hs
          where inner_hs.holding_id = h.id
        )
        order by hs.market_value_minor desc, h.symbol asc, h.name asc
      `,
    )
    .all<HoldingRow>();

  return rows.results;
}

export function printHoldings(holdings: HoldingRow[]) {
  if (holdings.length === 0) {
    console.log("No holdings found. Run `bun run cli -- sync` first.");
    return;
  }

  const marketValueMinor = holdings.reduce(
    (total, holding) => total + holding.marketValueMinor,
    0,
  );
  const costBasisMinor = holdings.reduce(
    (total, holding) => total + (holding.costBasisMinor ?? 0),
    0,
  );

  console.log(`Holdings: ${holdings.length}`);
  console.log(`Market value: ${formatUsd(marketValueMinor)}`);
  console.log(`Cost basis: ${formatUsd(costBasisMinor)}`);
  console.log("");
  console.log(
    [
      pad("Symbol", 9),
      pad("Account", 20),
      pad("Name", 46),
      pad("Quantity", 12),
      pad("Price", 12),
      pad("Value", 14),
      "Cost basis",
    ].join(""),
  );
  console.log("-".repeat(128));

  for (const holding of holdings) {
    console.log(
      [
        pad((holding.symbol || "-").slice(0, 8), 9),
        pad(holding.accountName.slice(0, 19), 20),
        pad(holding.name.slice(0, 45), 46),
        pad(holding.quantity.slice(0, 11), 12),
        pad(formatUsd(holding.priceMinor), 12),
        pad(formatUsd(holding.marketValueMinor), 14),
        formatUsd(holding.costBasisMinor),
      ].join(""),
    );
  }
}

export function toHoldingsJson(holdings: HoldingRow[]) {
  const marketValueMinor = holdings.reduce(
    (total, holding) => total + holding.marketValueMinor,
    0,
  );
  const costBasisMinor = holdings.reduce(
    (total, holding) => total + (holding.costBasisMinor ?? 0),
    0,
  );

  return {
    holdings: holdings.map((holding) => ({
      accountName: holding.accountName,
      assetClass: holding.assetClass,
      costBasisMinor: holding.costBasisMinor,
      currency: holding.currency,
      marketValueMinor: holding.marketValueMinor,
      name: holding.name,
      priceMinor: holding.priceMinor,
      quantity: holding.quantity,
      symbol: holding.symbol,
    })),
    schemaVersion: 1,
    totals: {
      costBasisMinor,
      currency: "USD",
      marketValueMinor,
    },
  };
}

export function printHoldingsJson(holdings: HoldingRow[]) {
  printJson(toHoldingsJson(holdings));
}
