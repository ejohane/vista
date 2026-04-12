import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import {
  createD1HouseholdAccess,
  createD1HouseholdService,
  getDb,
  type getPortfolioSnapshot,
  type HouseholdAccess,
  type HouseholdService,
  resolveHouseholdSelection,
} from "@vista/db";
import { useDeferredValue, useState } from "react";

import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireViewerContext } from "@/lib/auth";
import {
  formatCompactUsd,
  formatSignedUsd,
  formatUpdatedAt,
  formatUsd,
} from "@/lib/format";
import {
  buildHouseholdPath,
  readRequestedHouseholdId,
  resolveViewerHouseholdId,
} from "@/lib/household-routing";
import { createWebRuntimeHouseholdService } from "@/lib/runtime-household-service";
import { readCloudflareEnv } from "@/lib/server-context";
import { cn } from "@/lib/utils";
import type { Route } from "./+types/portfolio";

type PortfolioLoaderDeps = {
  createHouseholdAccess?: (db: ReturnType<typeof getDb>) => HouseholdAccess;
  createHouseholdService?: (
    db: ReturnType<typeof getDb>,
  ) => Pick<HouseholdService, "getPortfolioSnapshot">;
  getPortfolioSnapshot?: typeof getPortfolioSnapshot;
  loadPortfolioSnapshot?: (args: {
    env: Env;
    householdId: string;
  }) => Promise<Awaited<ReturnType<typeof getPortfolioSnapshot>>>;
  requireViewerContext?: typeof requireViewerContext;
  resolveHouseholdSelection?: typeof resolveHouseholdSelection;
};

// ── Types ──────────────────────────────────────────────────

type ReadyLoaderData = {
  accounts: Array<{
    accountId: string;
    accountType: "brokerage" | "retirement";
    holdings: Array<{
      assetClass: string;
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
    key: string;
    label: string;
    marketValueMinor: number;
  }>;
  asOfDate: string;
  householdName: string;
  kind: "ready";
  lastSyncedAt: string;
  topHoldings: Array<{
    accountName: string;
    assetClass: string;
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
  householdId: string;
};

type LoaderData =
  | { householdId?: string; kind: "empty" }
  | { kind: "error"; message: string; title: string }
  | ReadyLoaderData;

// ── Helpers ────────────────────────────────────────────────

function filterPortfolioAccounts(
  accounts: ReadyLoaderData["accounts"],
  query: string,
) {
  if (!query) return accounts;

  return accounts.flatMap((account) => {
    const accountMatches =
      `${account.name} ${account.institutionName} ${account.accountType}`
        .toLowerCase()
        .includes(query);
    const filteredHoldings = accountMatches
      ? account.holdings
      : account.holdings.filter((h) =>
          `${h.name} ${h.symbol ?? ""} ${h.assetClassLabel}`
            .toLowerCase()
            .includes(query),
        );

    if (!filteredHoldings.length) return [];

    return [
      {
        ...account,
        holdings: filteredHoldings,
        marketValueMinor: filteredHoldings.reduce(
          (sum, h) => sum + h.marketValueMinor,
          0,
        ),
      },
    ];
  });
}

function buildAllocationBuckets(accounts: ReadyLoaderData["accounts"]) {
  const buckets = new Map<
    string,
    {
      holdingCount: number;
      key: string;
      label: string;
      marketValueMinor: number;
    }
  >();

  for (const account of accounts) {
    for (const h of account.holdings) {
      const existing = buckets.get(h.assetClass) ?? {
        holdingCount: 0,
        key: h.assetClass,
        label: h.assetClassLabel,
        marketValueMinor: 0,
      };
      existing.holdingCount += 1;
      existing.marketValueMinor += h.marketValueMinor;
      buckets.set(h.assetClass, existing);
    }
  }

  return [...buckets.values()].sort(
    (a, b) => b.marketValueMinor - a.marketValueMinor,
  );
}

function buildTopHoldings(accounts: ReadyLoaderData["accounts"]) {
  return accounts
    .flatMap((a) =>
      a.holdings.map((h) => ({
        accountName: a.name,
        ...h,
      })),
    )
    .sort((a, b) => b.marketValueMinor - a.marketValueMinor)
    .slice(0, 5);
}

function pct(part: number, total: number) {
  if (total <= 0) return "0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

const bucketColors: Record<string, string> = {
  cash: "bg-emerald-400",
  equity: "bg-primary",
  fixed_income: "bg-sky-400",
  fund: "bg-violet-400",
  crypto: "bg-amber-400",
  other: "bg-muted-foreground",
};

// ── Loader ─────────────────────────────────────────────────

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Vista | Portfolio" },
    {
      name: "description",
      content: "Investment allocation, top holdings, and account breakdown.",
    },
  ];
}

function buildLoaderErrorData(title: string, message: string) {
  return {
    kind: "error" as const,
    message,
    title,
  };
}

export function createPortfolioLoader(deps: PortfolioLoaderDeps = {}) {
  const requireViewer = deps.requireViewerContext ?? requireViewerContext;
  const createHouseholdAccess =
    deps.createHouseholdAccess ?? createD1HouseholdAccess;
  const createHouseholdService =
    deps.createHouseholdService ?? createD1HouseholdService;
  const loadPortfolioSnapshot =
    deps.loadPortfolioSnapshot ??
    (deps.getPortfolioSnapshot
      ? ({ env, householdId }: { env: Env; householdId: string }) => {
          const getPortfolioSnapshot = deps.getPortfolioSnapshot;

          if (!getPortfolioSnapshot) {
            throw new Error("Portfolio snapshot loader is not configured.");
          }

          return getPortfolioSnapshot(getDb(env.DB), householdId);
        }
      : ({ env, householdId }: { env: Env; householdId: string }) =>
          createWebRuntimeHouseholdService(env).getPortfolioSnapshot(
            householdId,
          ));
  const resolveSelectedHousehold =
    deps.resolveHouseholdSelection ?? resolveHouseholdSelection;

  return async function loader({ context, request }: Route.LoaderArgs) {
    const env = readCloudflareEnv(context);

    try {
      if (
        deps.createHouseholdAccess ||
        deps.createHouseholdService ||
        deps.resolveHouseholdSelection
      ) {
        const db = getDb(env.DB);
        const household = await resolveSelectedHousehold(
          createHouseholdAccess(db),
          readRequestedHouseholdId(request),
        );

        if (!household) {
          return { kind: "empty" as const };
        }

        const snapshot = await createHouseholdService(db).getPortfolioSnapshot(
          household.id,
        );

        if (!snapshot) {
          return { householdId: household.id, kind: "empty" as const };
        }

        return {
          accounts: snapshot.accounts,
          allocationBuckets: snapshot.allocationBuckets,
          asOfDate: snapshot.asOfDate,
          householdId: household.id,
          householdName: snapshot.householdName,
          kind: "ready" as const,
          lastSyncedAt: snapshot.lastSyncedAt.toISOString(),
          topHoldings: snapshot.topHoldings,
          totals: snapshot.totals,
        };
      }

      const viewer = await requireViewer({ context, request });
      const householdId = resolveViewerHouseholdId(request, viewer.householdId);
      const snapshot = await loadPortfolioSnapshot({ env, householdId });

      if (!snapshot) {
        return { householdId, kind: "empty" as const };
      }

      return {
        accounts: snapshot.accounts,
        allocationBuckets: snapshot.allocationBuckets,
        asOfDate: snapshot.asOfDate,
        householdId,
        householdName: snapshot.householdName,
        kind: "ready" as const,
        lastSyncedAt: snapshot.lastSyncedAt.toISOString(),
        topHoldings: snapshot.topHoldings,
        totals: snapshot.totals,
      };
    } catch (error) {
      return buildLoaderErrorData(
        "Household selection required",
        error instanceof Error
          ? error.message
          : "Household selection could not be resolved.",
      );
    }
  };
}

export const loader = createPortfolioLoader();

// ── Page ───────────────────────────────────────────────────

export function PortfolioScreen({ loaderData }: { loaderData: LoaderData }) {
  const [searchValue, setSearchValue] = useState("");
  const deferredSearch = useDeferredValue(searchValue);
  const normalizedSearch = deferredSearch.trim().toLowerCase();

  if (loaderData.kind === "error") {
    return (
      <DashboardShell activePath="/portfolio">
        <div className="flex min-h-[70vh] items-center justify-center p-6">
          <Card className="w-full max-w-md">
            <CardContent className="space-y-3 p-6 text-center">
              <p className="text-lg font-medium">{loaderData.title}</p>
              <p className="text-sm text-muted-foreground">
                {loaderData.message}
              </p>
            </CardContent>
          </Card>
        </div>
      </DashboardShell>
    );
  }
  const filteredAccounts =
    loaderData.kind === "ready"
      ? filterPortfolioAccounts(loaderData.accounts, normalizedSearch)
      : [];
  const visibleBuckets = buildAllocationBuckets(filteredAccounts);
  const visibleTopHoldings = buildTopHoldings(filteredAccounts);
  const visibleTotal = filteredAccounts.reduce(
    (sum, a) => sum + a.marketValueMinor,
    0,
  );

  return (
    <DashboardShell activePath="/portfolio">
      <div className="space-y-6 p-5 lg:p-8">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">
              {loaderData.kind === "ready"
                ? loaderData.householdName
                : "Portfolio"}
            </p>
            <h1 className="vista-display mt-1 text-3xl lg:text-4xl">
              Investment Portfolio
            </h1>
          </div>
          {loaderData.kind === "ready" ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              Synced {formatUpdatedAt(loaderData.lastSyncedAt)}
            </div>
          ) : null}
        </div>

        {loaderData.kind === "empty" ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-lg font-medium">No holdings yet</p>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Connect Plaid to populate your portfolio view.
              </p>
              <div className="mt-6 flex gap-3">
                <a
                  href={
                    loaderData.householdId
                      ? buildHouseholdPath(
                          "/connect/plaid",
                          loaderData.householdId,
                        )
                      : "/connect/plaid"
                  }
                  className={buttonVariants()}
                >
                  Connect Plaid
                </a>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Search */}
            <div className="relative max-w-md">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder="Search holdings, symbols, accounts..."
                className="h-10 w-full rounded-lg border border-border/60 bg-card/60 pl-9 pr-4 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-2 focus:ring-ring/30"
              />
            </div>

            {/* Stats cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    Market value
                  </p>
                  <p className="vista-display mt-2 text-2xl">
                    {formatUsd(loaderData.totals.marketValueMinor)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    Cost basis
                  </p>
                  <p className="vista-display mt-2 text-2xl">
                    {formatUsd(loaderData.totals.costBasisMinor)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    Unrealized gain
                  </p>
                  <p
                    className={cn(
                      "vista-display mt-2 text-2xl",
                      loaderData.totals.unrealizedGainMinor >= 0
                        ? "text-emerald-400"
                        : "text-rose-400",
                    )}
                  >
                    {formatSignedUsd(loaderData.totals.unrealizedGainMinor)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    Holdings
                  </p>
                  <p className="vista-display mt-2 text-2xl">
                    {loaderData.totals.holdingCount}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    across {loaderData.totals.accountCount} accounts
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Allocation + Top holdings */}
            <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
              <Card>
                <CardHeader>
                  <CardTitle>Asset Allocation</CardTitle>
                  <CardDescription>
                    Portfolio breakdown by asset class
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Stacked bar */}
                  {visibleTotal > 0 ? (
                    <div className="flex h-4 overflow-hidden rounded-full">
                      {visibleBuckets.map((b) => (
                        <div
                          key={b.key}
                          className={cn(
                            "transition-all",
                            bucketColors[b.key] ?? "bg-muted-foreground",
                          )}
                          style={{
                            width: `${(b.marketValueMinor / visibleTotal) * 100}%`,
                          }}
                        />
                      ))}
                    </div>
                  ) : null}
                  {/* Legend rows */}
                  <div className="space-y-2 pt-2">
                    {visibleBuckets.map((b) => (
                      <div
                        key={b.key}
                        className="flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "size-2.5 rounded-full",
                              bucketColors[b.key] ?? "bg-muted-foreground",
                            )}
                          />
                          <span className="text-sm">{b.label}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {b.holdingCount}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-sm tabular-nums">
                          <span className="text-muted-foreground">
                            {pct(b.marketValueMinor, visibleTotal)}
                          </span>
                          <span className="font-medium">
                            {formatCompactUsd(b.marketValueMinor)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Top Holdings</CardTitle>
                  <CardDescription>Largest positions by value</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1">
                  {visibleTopHoldings.map((h, i) => (
                    <div
                      key={h.holdingId}
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-muted/30"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex size-7 items-center justify-center rounded-md bg-muted text-[10px] font-bold text-muted-foreground">
                          {i + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium">
                            {h.symbol ?? h.name}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {h.name !== (h.symbol ?? h.name)
                              ? h.name
                              : h.accountName}
                          </p>
                        </div>
                      </div>
                      <p className="shrink-0 text-[13px] font-medium tabular-nums">
                        {formatUsd(h.marketValueMinor)}
                      </p>
                    </div>
                  ))}
                  {visibleTopHoldings.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      No holdings match filter
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            {/* Account sleeves */}
            <Card>
              <CardHeader>
                <CardTitle>Account Sleeves</CardTitle>
                <CardDescription>Holdings grouped by account</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {filteredAccounts.map((account) => (
                  <div
                    key={account.accountId}
                    className="rounded-lg border border-border/60 bg-card/40"
                  >
                    <div className="flex items-center justify-between gap-4 border-b border-border/40 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">{account.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {account.institutionName} · {account.accountType}
                        </p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums">
                        {formatUsd(account.marketValueMinor)}
                      </p>
                    </div>
                    <div className="divide-y divide-border/30">
                      {account.holdings.map((h) => (
                        <div
                          key={h.holdingId}
                          className="flex items-center justify-between gap-4 px-4 py-2.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-[13px]">
                                {h.symbol ?? h.name}
                              </p>
                              <Badge
                                variant="outline"
                                className="shrink-0 text-[10px]"
                              >
                                {h.assetClassLabel}
                              </Badge>
                            </div>
                            {h.symbol ? (
                              <p className="truncate text-[11px] text-muted-foreground">
                                {h.name}
                              </p>
                            ) : null}
                          </div>
                          <div className="text-right">
                            <p className="text-[13px] font-medium tabular-nums">
                              {formatUsd(h.marketValueMinor)}
                            </p>
                            <p className="text-[11px] text-muted-foreground tabular-nums">
                              {h.quantity} shares
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {filteredAccounts.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {normalizedSearch
                      ? "No accounts match this search"
                      : "No accounts available"}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardShell>
  );
}

export default function Portfolio({ loaderData }: Route.ComponentProps) {
  return <PortfolioScreen loaderData={loaderData} />;
}
