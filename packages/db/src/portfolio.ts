import { and, desc, eq } from "drizzle-orm";

import type { VistaDb } from "./client";
import {
  accounts,
  type HoldingAssetClass,
  holdingSnapshots,
  holdings,
  households,
  syncRuns,
} from "./schema";

const assetClassLabels: Record<HoldingAssetClass, string> = {
  cash: "Cash",
  crypto: "Crypto",
  equity: "Equities",
  fixed_income: "Fixed income",
  fund: "Funds",
  other: "Other",
};

type PortfolioDb = Pick<VistaDb, "query" | "select">;

export type PortfolioSnapshot = {
  accounts: Array<{
    accountId: string;
    accountType: "brokerage" | "retirement";
    holdings: Array<{
      assetClass: HoldingAssetClass;
      assetClassLabel: string;
      holdingId: string;
      marketValueMinor: number;
      name: string;
      quantity: string;
      symbol: null | string;
    }>;
    institutionName: string;
    marketValueMinor: number;
    name: string;
  }>;
  allocationBuckets: Array<{
    holdingCount: number;
    key: HoldingAssetClass;
    label: string;
    marketValueMinor: number;
  }>;
  asOfDate: string;
  householdName: string;
  lastSyncedAt: Date;
  topHoldings: Array<{
    accountName: string;
    assetClass: HoldingAssetClass;
    assetClassLabel: string;
    holdingId: string;
    marketValueMinor: number;
    name: string;
    quantity: string;
    symbol: null | string;
  }>;
  totals: {
    accountCount: number;
    costBasisMinor: number;
    holdingCount: number;
    marketValueMinor: number;
    unrealizedGainMinor: number;
  };
};

function sortByMarketValueDescending<T extends { marketValueMinor: number }>(
  items: T[],
) {
  return [...items].sort(
    (left, right) => right.marketValueMinor - left.marketValueMinor,
  );
}

export async function getPortfolioSnapshot(
  db: PortfolioDb,
  householdId?: string,
): Promise<PortfolioSnapshot | null> {
  const household = householdId
    ? await db.query.households.findFirst({
        where: eq(households.id, householdId),
      })
    : await db.query.households.findFirst();

  if (!household) {
    return null;
  }

  const latestRunRow = await db
    .select({
      completedAt: syncRuns.completedAt,
      id: syncRuns.id,
    })
    .from(holdingSnapshots)
    .innerJoin(syncRuns, eq(holdingSnapshots.sourceSyncRunId, syncRuns.id))
    .innerJoin(accounts, eq(holdingSnapshots.accountId, accounts.id))
    .where(
      and(
        eq(accounts.householdId, household.id),
        eq(syncRuns.status, "succeeded"),
      ),
    )
    .orderBy(desc(syncRuns.completedAt), desc(syncRuns.startedAt))
    .limit(1);

  const latestRun = latestRunRow[0];

  if (!latestRun?.completedAt) {
    return null;
  }

  const rows = await db
    .select({
      accountDisplayName: accounts.displayName,
      accountId: accounts.id,
      accountInstitutionName: accounts.institutionName,
      accountName: accounts.name,
      accountType: accounts.accountType,
      asOfDate: holdingSnapshots.asOfDate,
      assetClass: holdings.assetClass,
      costBasisMinor: holdingSnapshots.costBasisMinor,
      holdingId: holdings.id,
      holdingName: holdings.name,
      marketValueMinor: holdingSnapshots.marketValueMinor,
      quantity: holdingSnapshots.quantity,
      symbol: holdings.symbol,
    })
    .from(holdingSnapshots)
    .innerJoin(holdings, eq(holdingSnapshots.holdingId, holdings.id))
    .innerJoin(accounts, eq(holdingSnapshots.accountId, accounts.id))
    .where(
      and(
        eq(accounts.householdId, household.id),
        eq(holdingSnapshots.sourceSyncRunId, latestRun.id),
      ),
    );

  if (!rows.length) {
    return null;
  }

  const allocationMap = new Map<
    HoldingAssetClass,
    { holdingCount: number; marketValueMinor: number }
  >();
  const accountMap = new Map<
    string,
    {
      accountId: string;
      accountType: "brokerage" | "retirement";
      holdings: PortfolioSnapshot["accounts"][number]["holdings"];
      institutionName: string;
      marketValueMinor: number;
      name: string;
    }
  >();
  const topHoldings: PortfolioSnapshot["topHoldings"] = [];
  let marketValueMinor = 0;
  let costBasisMinor = 0;

  for (const row of rows) {
    const assetClass = row.assetClass as HoldingAssetClass;
    const assetClassLabel = assetClassLabels[assetClass] ?? "Other";
    const accountName = row.accountDisplayName ?? row.accountName;

    marketValueMinor += row.marketValueMinor;
    costBasisMinor += row.costBasisMinor ?? 0;

    const currentBucket = allocationMap.get(assetClass) ?? {
      holdingCount: 0,
      marketValueMinor: 0,
    };
    currentBucket.holdingCount += 1;
    currentBucket.marketValueMinor += row.marketValueMinor;
    allocationMap.set(assetClass, currentBucket);

    const currentAccount = accountMap.get(row.accountId) ?? {
      accountId: row.accountId,
      accountType: row.accountType as "brokerage" | "retirement",
      holdings: [],
      institutionName: row.accountInstitutionName,
      marketValueMinor: 0,
      name: accountName,
    };
    currentAccount.marketValueMinor += row.marketValueMinor;
    currentAccount.holdings.push({
      assetClass,
      assetClassLabel,
      holdingId: row.holdingId,
      marketValueMinor: row.marketValueMinor,
      name: row.holdingName,
      quantity: row.quantity,
      symbol: row.symbol,
    });
    accountMap.set(row.accountId, currentAccount);

    topHoldings.push({
      accountName,
      assetClass,
      assetClassLabel,
      holdingId: row.holdingId,
      marketValueMinor: row.marketValueMinor,
      name: row.holdingName,
      quantity: row.quantity,
      symbol: row.symbol,
    });
  }

  return {
    accounts: sortByMarketValueDescending(
      Array.from(accountMap.values()).map((account) => ({
        ...account,
        holdings: sortByMarketValueDescending(account.holdings),
      })),
    ),
    allocationBuckets: sortByMarketValueDescending(
      Array.from(allocationMap.entries()).map(([key, bucket]) => ({
        holdingCount: bucket.holdingCount,
        key,
        label: assetClassLabels[key],
        marketValueMinor: bucket.marketValueMinor,
      })),
    ),
    asOfDate:
      rows[0]?.asOfDate ?? latestRun.completedAt.toISOString().slice(0, 10),
    householdName: household.name,
    lastSyncedAt: latestRun.completedAt,
    topHoldings: sortByMarketValueDescending(topHoldings).slice(0, 5),
    totals: {
      accountCount: accountMap.size,
      costBasisMinor,
      holdingCount: rows.length,
      marketValueMinor,
      unrealizedGainMinor: marketValueMinor - costBasisMinor,
    },
  };
}
