import type { LocalD1Database } from "./local-d1";

export const HOLDING_ASSET_CLASSES = [
  "cash",
  "equity",
  "fixed_income",
  "crypto",
  "fund",
  "other",
] as const;

export type HoldingAssetClass = (typeof HOLDING_ASSET_CLASSES)[number];

export type HoldingRow = {
  accountName: string;
  assetClass: HoldingAssetClass;
  costBasisMinor: null | number;
  currency: string;
  id: string;
  marketValueMinor: number;
  name: string;
  priceMinor: null | number;
  quantity: string;
  symbol: null | string;
};

export type HoldingDetail = {
  accountId: string;
  accountName: string;
  assetClass: HoldingAssetClass;
  costBasisMinor: null | number;
  currency: string;
  holdingId: string;
  marketValueMinor: null | number;
  name: string;
  overrideAssetClass: HoldingAssetClass | null;
  priceMinor: null | number;
  providerAssetClass: HoldingAssetClass;
  quantity: null | string;
  snapshotCapturedAt: null | number;
  symbol: null | string;
  updatedAt: number;
};

type HoldingMatch = {
  accountName: string;
  holdingId: string;
  name: string;
  symbol: null | string;
};

export type HoldingsCommand =
  | {
      kind: "list";
    }
  | {
      identifier: string;
      kind: "show";
    }
  | {
      assetClass: HoldingAssetClass;
      identifier: string;
      kind: "classify";
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

function formatTimestamp(timestamp: null | number) {
  if (timestamp === null) {
    return "-";
  }

  return new Date(timestamp).toISOString();
}

function pad(value: string, length: number) {
  return value.padEnd(length, " ");
}

function readOption(argv: string[], index: number, option: string) {
  const value = argv[index + 1];

  if (!value) {
    throw new Error(`${option} requires a value.`);
  }

  return value;
}

function isHoldingAssetClass(value: string): value is HoldingAssetClass {
  return HOLDING_ASSET_CLASSES.includes(value as HoldingAssetClass);
}

function parseAssetClass(value: string | undefined) {
  if (!value) {
    throw new Error("--asset-class is required.");
  }

  if (!isHoldingAssetClass(value)) {
    throw new Error(
      `--asset-class must be one of ${HOLDING_ASSET_CLASSES.join(", ")}.`,
    );
  }

  return value;
}

export function parseHoldingsArgs(argv: string[]): HoldingsCommand {
  const [command, ...rest] = argv;

  if (
    !command ||
    command === "list" ||
    command === "ls" ||
    command === "summary"
  ) {
    if (rest.length > 0) {
      throw new Error(
        `Unknown holdings ${command ?? "list"} option: ${rest[0]}`,
      );
    }

    return { kind: "list" };
  }

  if (command === "show") {
    const [identifier, ...extra] = rest;

    if (!identifier) {
      throw new Error("Usage: vista holdings show <id-or-symbol>");
    }

    if (extra.length > 0) {
      throw new Error(`Unknown holdings show option: ${extra[0]}`);
    }

    return {
      identifier,
      kind: "show",
    };
  }

  if (command === "classify") {
    const [identifier, ...options] = rest;

    if (!identifier) {
      throw new Error(
        "Usage: vista holdings classify <id-or-symbol> --asset-class <value>",
      );
    }

    const values: {
      assetClass?: string;
    } = {};

    for (let index = 0; index < options.length; index += 1) {
      const arg = options[index];

      if (arg === "--asset-class") {
        values.assetClass = readOption(options, index, arg);
        index += 1;
        continue;
      }

      throw new Error(`Unknown holdings classify option: ${arg}`);
    }

    return {
      assetClass: parseAssetClass(values.assetClass),
      identifier,
      kind: "classify",
    };
  }

  throw new Error(`Unknown holdings command: ${command}`);
}

export async function listHoldings(database: LocalD1Database) {
  const rows = await database
    .prepare(
      `
        select
          h.id,
          coalesce(a.display_name, a.name) as accountName,
          h.symbol,
          h.name,
          coalesce(hco.asset_class, h.asset_class) as assetClass,
          h.currency,
          hs.quantity,
          hs.price_minor as priceMinor,
          hs.market_value_minor as marketValueMinor,
          hs.cost_basis_minor as costBasisMinor
        from holdings h
        join accounts a on a.id = h.account_id
        left join holding_classification_overrides hco on hco.holding_id = h.id
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

async function findHoldingMatches(
  database: LocalD1Database,
  identifier: string,
) {
  const idMatches = await database
    .prepare(
      `
        select
          h.id as holdingId,
          h.symbol,
          h.name,
          coalesce(a.display_name, a.name) as accountName
        from holdings h
        join accounts a on a.id = h.account_id
        where h.id = ?
        order by h.id asc
      `,
    )
    .bind(identifier)
    .all<HoldingMatch>();

  if (idMatches.results.length > 0) {
    return idMatches.results;
  }

  const symbolMatches = await database
    .prepare(
      `
        select
          h.id as holdingId,
          h.symbol,
          h.name,
          coalesce(a.display_name, a.name) as accountName
        from holdings h
        join accounts a on a.id = h.account_id
        where lower(h.symbol) = lower(?)
        order by h.symbol asc, h.name asc, h.id asc
      `,
    )
    .bind(identifier)
    .all<HoldingMatch>();

  return symbolMatches.results;
}

function formatAmbiguousHoldingError(
  identifier: string,
  matches: HoldingMatch[],
) {
  return [
    `Holding symbol ${identifier} matched ${matches.length} holdings. Pass a holding id.`,
    ...matches.map(
      (match) =>
        `- ${match.holdingId} (${match.symbol ?? "-"}; ${match.accountName}; ${match.name})`,
    ),
  ].join("\n");
}

async function resolveHoldingId(database: LocalD1Database, identifier: string) {
  const matches = await findHoldingMatches(database, identifier);

  if (matches.length === 0) {
    throw new Error(`Holding ${identifier} could not be found.`);
  }

  if (matches.length > 1) {
    throw new Error(formatAmbiguousHoldingError(identifier, matches));
  }

  return matches[0].holdingId;
}

export async function getHolding(
  database: LocalD1Database,
  identifier: string,
) {
  const holdingId = await resolveHoldingId(database, identifier);
  const row = await database
    .prepare(
      `
        select
          h.id as holdingId,
          h.account_id as accountId,
          coalesce(a.display_name, a.name) as accountName,
          h.symbol,
          h.name,
          h.asset_class as providerAssetClass,
          hco.asset_class as overrideAssetClass,
          coalesce(hco.asset_class, h.asset_class) as assetClass,
          h.currency,
          h.updated_at as updatedAt,
          hs.quantity,
          hs.price_minor as priceMinor,
          hs.market_value_minor as marketValueMinor,
          hs.cost_basis_minor as costBasisMinor,
          hs.captured_at as snapshotCapturedAt
        from holdings h
        join accounts a on a.id = h.account_id
        left join holding_classification_overrides hco on hco.holding_id = h.id
        left join holding_snapshots hs on hs.holding_id = h.id
          and hs.captured_at = (
            select max(inner_hs.captured_at)
            from holding_snapshots inner_hs
            where inner_hs.holding_id = h.id
          )
        where h.id = ?
        limit 1
      `,
    )
    .bind(holdingId)
    .first<HoldingDetail>();

  if (!row) {
    throw new Error(`Holding ${identifier} could not be found.`);
  }

  return row;
}

export async function classifyHolding(
  database: LocalD1Database,
  identifier: string,
  assetClass: HoldingAssetClass,
) {
  const holdingId = await resolveHoldingId(database, identifier);
  const now = Date.now();

  await database
    .prepare(
      `
        insert into holding_classification_overrides (
          holding_id,
          asset_class,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?)
        on conflict(holding_id) do update set
          asset_class = excluded.asset_class,
          updated_at = excluded.updated_at
      `,
    )
    .bind(holdingId, assetClass, now, now)
    .run();

  return getHolding(database, holdingId);
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
      pad("Class", 14),
      pad("Name", 46),
      pad("Quantity", 12),
      pad("Price", 12),
      pad("Value", 14),
      pad("Cost basis", 14),
      "ID",
    ].join(""),
  );
  console.log("-".repeat(176));

  for (const holding of holdings) {
    console.log(
      [
        pad((holding.symbol || "-").slice(0, 8), 9),
        pad(holding.accountName.slice(0, 19), 20),
        pad(holding.assetClass.slice(0, 13), 14),
        pad(holding.name.slice(0, 45), 46),
        pad(holding.quantity.slice(0, 11), 12),
        pad(formatUsd(holding.priceMinor), 12),
        pad(formatUsd(holding.marketValueMinor), 14),
        pad(formatUsd(holding.costBasisMinor), 14),
        holding.id,
      ].join(""),
    );
  }
}

export function printHoldingDetail(holding: HoldingDetail) {
  console.log("Holding");
  console.log(`ID:                   ${holding.holdingId}`);
  console.log(`Account:              ${holding.accountName}`);
  console.log(`Account ID:           ${holding.accountId}`);
  console.log(`Symbol:               ${holding.symbol ?? "-"}`);
  console.log(`Name:                 ${holding.name}`);
  console.log(`Current asset class:  ${holding.assetClass}`);
  console.log(`Provider asset class: ${holding.providerAssetClass}`);
  console.log(`Override asset class: ${holding.overrideAssetClass ?? "-"}`);
  console.log(`Quantity:             ${holding.quantity ?? "-"}`);
  console.log(`Price:                ${formatUsd(holding.priceMinor)}`);
  console.log(`Market value:         ${formatUsd(holding.marketValueMinor)}`);
  console.log(`Cost basis:           ${formatUsd(holding.costBasisMinor)}`);
  console.log(`Currency:             ${holding.currency}`);
  console.log(`Holding updated:      ${formatTimestamp(holding.updatedAt)}`);
  console.log(
    `Latest snapshot:      ${formatTimestamp(holding.snapshotCapturedAt)}`,
  );
}

export function printHoldingsHelp() {
  console.log(`Vista holdings commands

Usage:
  vista holdings
  vista holdings show <id-or-symbol>
  vista holdings classify <id-or-symbol> --asset-class cash|equity|fixed_income|crypto|fund|other
`);
}

export async function runHoldingsCommand(
  database: LocalD1Database,
  command: HoldingsCommand,
) {
  if (command.kind === "list") {
    printHoldings(await listHoldings(database));
    return;
  }

  if (command.kind === "show") {
    printHoldingDetail(await getHolding(database, command.identifier));
    return;
  }

  const holding = await classifyHolding(
    database,
    command.identifier,
    command.assetClass,
  );

  console.log("Saved holding classification override.");
  printHoldingDetail(holding);
}
