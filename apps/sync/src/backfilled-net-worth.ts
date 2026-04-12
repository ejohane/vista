import { rebuildHistoricalNetWorthFacts } from "@vista/db";

type ImportedSecurityPricePoint = {
  closePriceMinor: number;
  priceDate: string;
};

type ImportedSecurityPriceResult = {
  importedPriceCount: number;
  missingPriceCount: number;
};

type SecurityPriceClient = {
  fetchDailyPrices(args: {
    endDate: string;
    security: {
      id: string;
      name: string;
      priceSource: string;
      securitySubtype: null | string;
      securityType: null | string;
      symbol: null | string;
    };
    startDate: string;
  }): Promise<ImportedSecurityPricePoint[]>;
};

type HistoricalNetWorthRefreshResult = ImportedSecurityPriceResult & {
  accountValueFactCount: number;
  netWorthFactCount: number;
  positionFactCount: number;
  rebuiltHouseholdCount: number;
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query";
const ALPHA_VANTAGE_SERIES_FUNCTIONS = [
  "TIME_SERIES_DAILY_ADJUSTED",
  "TIME_SERIES_DAILY",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readAlphaVantageError(payload: Record<string, unknown>) {
  const errorMessage = payload["Error Message"];

  if (typeof errorMessage === "string" && errorMessage.trim()) {
    return errorMessage;
  }

  const note = payload.Note;

  if (typeof note === "string" && note.trim()) {
    return note;
  }

  const information = payload.Information;

  if (typeof information === "string" && information.trim()) {
    return information;
  }

  return null;
}

function parseAlphaVantageDailyPrices(args: {
  payload: Record<string, unknown>;
  securitySymbol: string;
}) {
  const series = args.payload["Time Series (Daily)"];

  if (!isRecord(series)) {
    const errorMessage = readAlphaVantageError(args.payload);

    throw new Error(
      errorMessage
        ? `Alpha Vantage returned no daily series for ${args.securitySymbol}: ${errorMessage}`
        : `Alpha Vantage returned no daily series for ${args.securitySymbol}.`,
    );
  }

  const prices: ImportedSecurityPricePoint[] = [];

  for (const [priceDate, row] of Object.entries(series)) {
    if (!isRecord(row)) {
      continue;
    }

    const adjustedClose = row["5. adjusted close"];
    const close = row["4. close"];
    const closeValue = adjustedClose ?? close;

    if (typeof closeValue !== "string") {
      continue;
    }

    const parsedClose = Number.parseFloat(closeValue);

    if (!Number.isFinite(parsedClose)) {
      continue;
    }

    prices.push({
      closePriceMinor: Math.round(parsedClose * 100),
      priceDate,
    });
  }

  return prices;
}

type SecurityRow = {
  id: string;
  name: string;
  priceSource: string;
  securitySubtype: null | string;
  securityType: null | string;
  symbol: null | string;
};

function isBusinessDate(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  const day = date.getUTCDay();

  return day !== 0 && day !== 6;
}

function addDays(isoDate: string, dayCount: number) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + dayCount);
  return date.toISOString().slice(0, 10);
}

function listBusinessDates(startDate: string, endDate: string) {
  const dates: string[] = [];

  for (
    let currentDate = startDate;
    currentDate <= endDate;
    currentDate = addDays(currentDate, 1)
  ) {
    if (isBusinessDate(currentDate)) {
      dates.push(currentDate);
    }
  }

  return dates;
}

function buildInClause(values: string[]) {
  return values.map(() => "?").join(", ");
}

async function loadImportableSecurities(args: {
  database: D1Database;
  householdId?: string;
}) {
  const scopedHouseholdFilter = args.householdId
    ? `
          and scoped.household_id = ?
      `
    : "";
  const rows = await args.database
    .prepare(
      `
        select distinct
          securities.id,
          securities.name,
          securities.price_source as priceSource,
          securities.security_subtype as securitySubtype,
          securities.security_type as securityType,
          securities.symbol
        from securities
        inner join (
          select
            holdings.security_id,
            accounts.household_id
          from holdings
          inner join accounts on accounts.id = holdings.account_id

          union

          select
            investment_transactions.security_id,
            accounts.household_id
          from investment_transactions
          inner join accounts on accounts.id = investment_transactions.account_id
          where investment_transactions.security_id is not null
        ) scoped on scoped.security_id = securities.id
        where securities.symbol is not null
          and securities.price_source = ?
          ${scopedHouseholdFilter}
      `,
    )
    .bind("alpha_vantage", ...(args.householdId ? [args.householdId] : []))
    .all<SecurityRow>();

  return rows.results;
}

async function loadBackfillWindow(args: {
  database: D1Database;
  householdId: string;
}) {
  const row = await args.database
    .prepare(
      `
        select
          accounts.household_id as householdId,
          max(holding_snapshots.as_of_date) as latestHoldingDate,
          min(coalesce(investment_transactions.trade_at, investment_transactions.posted_at)) as earliestTransactionAt
        from accounts
        left join holdings on holdings.account_id = accounts.id
        left join holding_snapshots on holding_snapshots.holding_id = holdings.id
        left join investment_transactions on investment_transactions.account_id = accounts.id
        where accounts.household_id = ?
          and accounts.reporting_group = ?
        group by accounts.household_id
      `,
    )
    .bind(args.householdId, "investments")
    .first<{
      earliestTransactionAt: null | number;
      householdId: string;
      latestHoldingDate: null | string;
    }>();

  if (!row?.latestHoldingDate) {
    return null;
  }

  const earliestTransactionDate =
    typeof row.earliestTransactionAt === "number"
      ? new Date(row.earliestTransactionAt).toISOString().slice(0, 10)
      : null;

  return {
    endDate: row.latestHoldingDate,
    householdId: row.householdId,
    startDate: earliestTransactionDate ?? row.latestHoldingDate,
  };
}

async function loadHouseholdIdsForRunIds(args: {
  database: D1Database;
  runIds: string[];
}) {
  if (args.runIds.length === 0) {
    return [];
  }

  const rows = await args.database
    .prepare(
      `
        select distinct household_id as householdId
        from sync_runs
        where id in (${buildInClause(args.runIds)})
      `,
    )
    .bind(...args.runIds)
    .all<{ householdId: string }>();

  return rows.results.map((row) => row.householdId);
}

async function upsertSecurityPriceDaily(args: {
  closePriceMinor: null | number;
  currency?: string;
  database: D1Database;
  fetchedAt: number;
  isEstimated: boolean;
  priceDate: string;
  securityId: string;
  source: "alpha_vantage" | "missing";
}) {
  await args.database
    .prepare(
      `
        insert into security_price_daily (
          security_id,
          price_date,
          close_price_minor,
          currency,
          source,
          is_estimated,
          fetched_at
        )
        values (?, ?, ?, ?, ?, ?, ?)
        on conflict(security_id, price_date) do update set
          close_price_minor = case
            when excluded.close_price_minor is null and security_price_daily.close_price_minor is not null
              then security_price_daily.close_price_minor
            else excluded.close_price_minor
          end,
          currency = excluded.currency,
          source = case
            when excluded.close_price_minor is null and security_price_daily.close_price_minor is not null
              then security_price_daily.source
            else excluded.source
          end,
          is_estimated = case
            when excluded.close_price_minor is null and security_price_daily.close_price_minor is not null
              then security_price_daily.is_estimated
            else excluded.is_estimated
          end,
          fetched_at = excluded.fetched_at
      `,
    )
    .bind(
      args.securityId,
      args.priceDate,
      args.closePriceMinor,
      args.currency ?? "USD",
      args.source,
      args.isEstimated ? 1 : 0,
      args.fetchedAt,
    )
    .run();
}

export async function importSecurityPriceHistory(args: {
  database: D1Database;
  endDate: string;
  householdId?: string;
  now: Date;
  priceClient: SecurityPriceClient;
  startDate: string;
}): Promise<ImportedSecurityPriceResult> {
  const securities = await loadImportableSecurities({
    database: args.database,
    householdId: args.householdId,
  });
  let importedPriceCount = 0;
  let missingPriceCount = 0;

  for (const security of securities) {
    const importedPrices = await args.priceClient.fetchDailyPrices({
      endDate: args.endDate,
      security,
      startDate: args.startDate,
    });
    const importedPricesByDate = new Map(
      importedPrices.map((price) => [price.priceDate, price]),
    );

    for (const priceDate of listBusinessDates(args.startDate, args.endDate)) {
      const importedPrice = importedPricesByDate.get(priceDate);

      if (importedPrice) {
        importedPriceCount += 1;
        await upsertSecurityPriceDaily({
          closePriceMinor: importedPrice.closePriceMinor,
          database: args.database,
          fetchedAt: args.now.getTime(),
          isEstimated: false,
          priceDate,
          securityId: security.id,
          source: "alpha_vantage",
        });
        continue;
      }

      missingPriceCount += 1;
      await upsertSecurityPriceDaily({
        closePriceMinor: null,
        database: args.database,
        fetchedAt: args.now.getTime(),
        isEstimated: true,
        priceDate,
        securityId: security.id,
        source: "missing",
      });
    }
  }

  return {
    importedPriceCount,
    missingPriceCount,
  };
}

export function createAlphaVantagePriceClient(args: {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: FetchLike;
}): SecurityPriceClient {
  const fetchFn = args.fetchFn ?? fetch;
  const baseUrl = args.baseUrl ?? ALPHA_VANTAGE_BASE_URL;

  return {
    async fetchDailyPrices({ endDate, security, startDate }) {
      if (!security.symbol) {
        return [];
      }

      let lastError: null | Error = null;

      for (const seriesFunction of ALPHA_VANTAGE_SERIES_FUNCTIONS) {
        const requestUrl = new URL(baseUrl);
        requestUrl.searchParams.set("apikey", args.apiKey);
        requestUrl.searchParams.set("function", seriesFunction);
        requestUrl.searchParams.set("outputsize", "full");
        requestUrl.searchParams.set("symbol", security.symbol.trim());

        const response = await fetchFn(requestUrl);

        if (!response.ok) {
          throw new Error(
            `Alpha Vantage request failed for ${security.symbol} with status ${response.status}.`,
          );
        }

        const payload = (await response.json()) as Record<string, unknown>;

        try {
          return parseAlphaVantageDailyPrices({
            payload,
            securitySymbol: security.symbol,
          }).filter(
            (price) =>
              price.priceDate >= startDate && price.priceDate <= endDate,
          );
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
        }
      }

      throw (
        lastError ??
        new Error(
          `Alpha Vantage returned no usable daily prices for ${security.symbol}.`,
        )
      );
    },
  };
}

export async function refreshHistoricalNetWorthForHousehold(args: {
  database: D1Database;
  endDate?: string;
  householdId: string;
  now: Date;
  priceClient?: SecurityPriceClient;
  startDate?: string;
}): Promise<HistoricalNetWorthRefreshResult> {
  const discoveredWindow = await loadBackfillWindow({
    database: args.database,
    householdId: args.householdId,
  });

  if (!discoveredWindow) {
    return {
      accountValueFactCount: 0,
      importedPriceCount: 0,
      missingPriceCount: 0,
      netWorthFactCount: 0,
      positionFactCount: 0,
      rebuiltHouseholdCount: 0,
    };
  }

  const endDate = args.endDate ?? discoveredWindow.endDate;
  const startDate = args.startDate ?? discoveredWindow.startDate;
  let importedPriceCount = 0;
  let missingPriceCount = 0;

  if (args.priceClient) {
    const priceImportResult = await importSecurityPriceHistory({
      database: args.database,
      endDate,
      householdId: args.householdId,
      now: args.now,
      priceClient: args.priceClient,
      startDate,
    });

    importedPriceCount = priceImportResult.importedPriceCount;
    missingPriceCount = priceImportResult.missingPriceCount;
  }

  const rebuildResult = await rebuildHistoricalNetWorthFacts({
    database: args.database,
    endDate,
    householdId: args.householdId,
    now: args.now,
    startDate,
  });
  const rebuiltHouseholdCount =
    rebuildResult.accountValueFactCount > 0 ||
    rebuildResult.netWorthFactCount > 0 ||
    rebuildResult.positionFactCount > 0
      ? 1
      : 0;

  return {
    ...rebuildResult,
    importedPriceCount,
    missingPriceCount,
    rebuiltHouseholdCount,
  };
}

export async function refreshHistoricalNetWorthForRunIds(args: {
  database: D1Database;
  now: Date;
  priceClient?: SecurityPriceClient;
  runIds: string[];
}): Promise<HistoricalNetWorthRefreshResult> {
  const householdIds = await loadHouseholdIdsForRunIds({
    database: args.database,
    runIds: args.runIds,
  });
  const uniqueHouseholdIds = [...new Set(householdIds)];
  const result: HistoricalNetWorthRefreshResult = {
    accountValueFactCount: 0,
    importedPriceCount: 0,
    missingPriceCount: 0,
    netWorthFactCount: 0,
    positionFactCount: 0,
    rebuiltHouseholdCount: 0,
  };

  for (const householdId of uniqueHouseholdIds) {
    const householdResult = await refreshHistoricalNetWorthForHousehold({
      database: args.database,
      householdId,
      now: args.now,
      priceClient: args.priceClient,
    });

    result.accountValueFactCount += householdResult.accountValueFactCount;
    result.importedPriceCount += householdResult.importedPriceCount;
    result.missingPriceCount += householdResult.missingPriceCount;
    result.netWorthFactCount += householdResult.netWorthFactCount;
    result.positionFactCount += householdResult.positionFactCount;
    result.rebuiltHouseholdCount += householdResult.rebuiltHouseholdCount;
  }

  return result;
}
