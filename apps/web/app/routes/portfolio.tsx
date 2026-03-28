import { BuildingsIcon } from "@phosphor-icons/react";
import { getDb, getPortfolioSnapshot } from "@vista/db";
import { useState } from "react";

import type { AppSidebarSection } from "@/components/app-sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  formatCompactUsd,
  formatSignedUsd,
  formatUpdatedAt,
  formatUsd,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Route } from "./+types/portfolio";

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
};

type LoaderData = { kind: "empty" } | ReadyLoaderData;

function filterPortfolioAccounts(
  accounts: ReadyLoaderData["accounts"],
  query: string,
) {
  if (!query) {
    return accounts;
  }

  return accounts.flatMap((account) => {
    const accountMatches =
      `${account.name} ${account.institutionName} ${account.accountType}`
        .toLowerCase()
        .includes(query);
    const filteredHoldings = accountMatches
      ? account.holdings
      : account.holdings.filter((holding) =>
          `${holding.name} ${holding.symbol ?? ""} ${holding.assetClassLabel}`
            .toLowerCase()
            .includes(query),
        );

    if (!filteredHoldings.length) {
      return [];
    }

    return [
      {
        ...account,
        holdings: filteredHoldings,
        marketValueMinor: filteredHoldings.reduce(
          (sum, holding) => sum + holding.marketValueMinor,
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
    for (const holding of account.holdings) {
      const existing = buckets.get(holding.assetClass) ?? {
        holdingCount: 0,
        key: holding.assetClass,
        label: holding.assetClassLabel,
        marketValueMinor: 0,
      };

      existing.holdingCount += 1;
      existing.marketValueMinor += holding.marketValueMinor;
      buckets.set(holding.assetClass, existing);
    }
  }

  return [...buckets.values()].sort(
    (left, right) => right.marketValueMinor - left.marketValueMinor,
  );
}

function buildTopHoldings(accounts: ReadyLoaderData["accounts"]) {
  return accounts
    .flatMap((account) =>
      account.holdings.map((holding) => ({
        accountName: account.name,
        assetClass: holding.assetClass,
        assetClassLabel: holding.assetClassLabel,
        holdingId: holding.holdingId,
        marketValueMinor: holding.marketValueMinor,
        name: holding.name,
        quantity: holding.quantity,
        symbol: holding.symbol,
      })),
    )
    .sort((left, right) => right.marketValueMinor - left.marketValueMinor)
    .slice(0, 5);
}

function formatShare(marketValueMinor: number, totalMinor: number) {
  if (totalMinor <= 0) {
    return "0.0%";
  }

  return `${((marketValueMinor / totalMinor) * 100).toFixed(1)}%`;
}

function MetricCard({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[28px] border border-border/70 bg-background/80 p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-4 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
    </div>
  );
}

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Vista | Portfolio" },
    {
      name: "description",
      content:
        "Read the current investment allocation, top holdings, and account-level portfolio breakdown.",
    },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  const snapshot = await getPortfolioSnapshot(getDb(context.cloudflare.env.DB));

  if (!snapshot) {
    return {
      kind: "empty" as const,
    };
  }

  return {
    accounts: snapshot.accounts,
    allocationBuckets: snapshot.allocationBuckets,
    asOfDate: snapshot.asOfDate,
    householdName: snapshot.householdName,
    kind: "ready" as const,
    lastSyncedAt: snapshot.lastSyncedAt.toISOString(),
    topHoldings: snapshot.topHoldings,
    totals: snapshot.totals,
  };
}

export function PortfolioScreen({ loaderData }: { loaderData: LoaderData }) {
  const [searchValue, setSearchValue] = useState("");
  const normalizedSearch = searchValue.trim().toLowerCase();
  const filteredAccounts =
    loaderData.kind === "ready"
      ? filterPortfolioAccounts(loaderData.accounts, normalizedSearch)
      : [];
  const visibleAllocationBuckets = buildAllocationBuckets(filteredAccounts);
  const visibleTopHoldings = buildTopHoldings(filteredAccounts);
  const visibleTotalMinor = filteredAccounts.reduce(
    (sum, account) => sum + account.marketValueMinor,
    0,
  );
  const sidebarSections: AppSidebarSection[] =
    loaderData.kind === "ready"
      ? [
          {
            title: "Portfolio",
            items: [
              {
                badge: "4",
                href: "#overview",
                isActive: true,
                title: "Overview",
              },
              {
                href: "#allocation",
                title: "Allocation",
              },
              {
                href: "#accounts",
                title: "Accounts",
              },
              {
                href: "#holdings",
                title: "Top holdings",
              },
            ],
          },
          {
            title: normalizedSearch ? "Matches" : "Accounts",
            items: filteredAccounts.length
              ? filteredAccounts.map((account) => ({
                  badge: String(account.holdings.length),
                  href: `#account-${account.accountId}`,
                  title: account.name,
                }))
              : [
                  {
                    badge: "0",
                    href: "#accounts",
                    title: "No matching holdings",
                  },
                ],
          },
        ]
      : [
          {
            title: "Setup",
            items: [
              {
                href: "#overview",
                isActive: true,
                title: "Overview",
              },
            ],
          },
        ];

  return (
    <SidebarProvider defaultOpen>
      <AppSidebar
        helperText={
          loaderData.kind === "ready"
            ? normalizedSearch
              ? `Filtering portfolio holdings for "${searchValue}".`
              : "Use this screen to inspect allocation, not daily movement."
            : "Connect Plaid and run the first sync to populate holdings."
        }
        onSearchValueChange={setSearchValue}
        searchDisabled={loaderData.kind === "empty"}
        searchPlaceholder={
          loaderData.kind === "ready"
            ? "Search holdings, symbols, or accounts..."
            : "Portfolio data required"
        }
        searchValue={searchValue}
        sections={sidebarSections}
        status={loaderData.kind}
        subtitle={
          loaderData.kind === "ready"
            ? `Portfolio synced ${formatUpdatedAt(loaderData.lastSyncedAt)}`
            : "No holdings imported yet"
        }
        summary={
          loaderData.kind === "ready"
            ? [
                {
                  label: "Invested",
                  value: formatCompactUsd(loaderData.totals.marketValueMinor),
                },
                {
                  label: "Holdings",
                  value: String(loaderData.totals.holdingCount),
                },
              ]
            : [
                {
                  label: "Status",
                  value: "Awaiting holdings",
                },
                {
                  label: "Next step",
                  value: "Run sync",
                },
              ]
        }
        title={loaderData.kind === "ready" ? loaderData.householdName : "Vista"}
      />
      <SidebarInset className="min-h-svh bg-background">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b border-border/70 bg-background/90 px-4 backdrop-blur md:px-6">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-vertical:h-4 data-vertical:self-auto"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <a href="/" className="text-muted-foreground">
                  Vista
                </a>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>Portfolio composition</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <main className="relative flex flex-1 flex-col overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,_rgba(223,139,71,0.16),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(67,125,158,0.14),_transparent_28%),linear-gradient(180deg,_rgba(255,252,247,1)_0%,_rgba(248,244,238,0.98)_58%,_rgba(243,238,232,0.94)_100%)]" />
          <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
            <section id="overview" className="scroll-mt-24 space-y-4">
              <Card className="overflow-hidden border-border/70 bg-card/95 shadow-sm">
                <CardHeader className="gap-4 border-b border-border/70 bg-[linear-gradient(135deg,_rgba(255,255,255,0.92),_rgba(246,240,232,0.9))]">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="space-y-3">
                      <Badge
                        variant="outline"
                        className="w-fit border-border/80 bg-background/80"
                      >
                        Portfolio composition
                      </Badge>
                      <div className="space-y-2">
                        <CardTitle className="text-4xl tracking-tight sm:text-5xl">
                          Allocation at a glance
                        </CardTitle>
                        <CardDescription className="max-w-3xl text-base leading-7 text-muted-foreground">
                          Read the current mix across accounts, holdings, and
                          asset buckets without digging through provider data.
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <a
                        href="/"
                        className={cn(
                          buttonVariants({
                            size: "sm",
                            variant: "ghost",
                          }),
                        )}
                      >
                        Back to snapshot
                      </a>
                      <a
                        href="/accounts/review"
                        className={cn(
                          buttonVariants({
                            size: "sm",
                            variant: "outline",
                          }),
                        )}
                      >
                        Review accounts
                      </a>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  {loaderData.kind === "ready" ? (
                    <div className="grid gap-4 lg:grid-cols-4">
                      <MetricCard
                        label="Total invested"
                        value={formatUsd(loaderData.totals.marketValueMinor)}
                        detail={`As of ${loaderData.asOfDate}`}
                      />
                      <MetricCard
                        label="Unrealized gain"
                        value={formatSignedUsd(
                          loaderData.totals.unrealizedGainMinor,
                        )}
                        detail={`Against ${formatUsd(loaderData.totals.costBasisMinor)} in cost basis`}
                      />
                      <MetricCard
                        label="Accounts"
                        value={String(loaderData.totals.accountCount)}
                        detail="Brokerage and retirement accounts with active holdings."
                      />
                      <MetricCard
                        label="Holdings"
                        value={String(loaderData.totals.holdingCount)}
                        detail="Synthetic cash plus provider positions in the latest sync."
                      />
                    </div>
                  ) : (
                    <div className="rounded-[28px] border border-dashed border-border/80 bg-background/75 p-6">
                      <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                        Portfolio composition
                      </p>
                      <p className="mt-4 text-2xl font-semibold tracking-tight">
                        No investment holdings yet
                      </p>
                      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                        Connect Plaid and run the first sync after saving a
                        provider connection. Once holdings are imported, this
                        page will show current allocation, top positions, and
                        account-level splits.
                      </p>
                      <div className="mt-5 flex flex-wrap items-center gap-3">
                        <a
                          href="/connect/plaid"
                          className={cn(
                            buttonVariants({
                              size: "sm",
                              variant: "outline",
                            }),
                          )}
                        >
                          Connect Plaid
                        </a>
                        <a
                          href="/"
                          className={cn(
                            buttonVariants({
                              size: "sm",
                              variant: "outline",
                            }),
                          )}
                        >
                          Back to snapshot
                        </a>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            {loaderData.kind === "ready" ? (
              <>
                <section
                  id="allocation"
                  className="grid scroll-mt-24 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]"
                >
                  <Card className="border-border/70 bg-card/95 shadow-sm">
                    <CardHeader className="gap-2">
                      <CardTitle className="text-2xl tracking-tight">
                        Asset mix
                      </CardTitle>
                      <CardDescription className="leading-6">
                        The current allocation is grouped by normalized asset
                        class so the page stays provider-agnostic above the sync
                        layer.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {visibleAllocationBuckets.length ? (
                        visibleAllocationBuckets.map((bucket) => (
                          <div
                            key={bucket.key}
                            className="rounded-[24px] border border-border/70 bg-background/80 p-4"
                          >
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <p className="font-medium">{bucket.label}</p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {bucket.holdingCount} holding
                                  {bucket.holdingCount === 1 ? "" : "s"}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="font-semibold">
                                  {formatUsd(bucket.marketValueMinor)}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {formatShare(
                                    bucket.marketValueMinor,
                                    visibleTotalMinor,
                                  )}
                                </p>
                              </div>
                            </div>
                            <div className="mt-4 h-3 rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-[linear-gradient(90deg,_rgba(219,126,63,0.92),_rgba(65,111,140,0.88))]"
                                style={{
                                  width: `${Math.max(
                                    6,
                                    Math.round(
                                      (bucket.marketValueMinor /
                                        Math.max(visibleTotalMinor, 1)) *
                                        100,
                                    ),
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm leading-6 text-muted-foreground">
                          No holdings match the current filter.
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  <Card
                    id="holdings"
                    className="border-border/70 bg-[linear-gradient(180deg,_rgba(255,255,255,0.94),_rgba(247,241,234,0.95))] shadow-sm"
                  >
                    <CardHeader className="gap-2">
                      <CardTitle className="text-2xl tracking-tight">
                        Top holdings
                      </CardTitle>
                      <CardDescription className="leading-6">
                        Largest positions across visible accounts in the latest
                        imported snapshot.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {visibleTopHoldings.length ? (
                        visibleTopHoldings.map((holding, index) => (
                          <div
                            key={holding.holdingId}
                            className="rounded-[24px] border border-border/70 bg-background/85 p-4"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                                  #{index + 1}
                                </p>
                                <p className="mt-2 font-medium">
                                  {holding.name}
                                </p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {[holding.symbol, holding.accountName]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="font-semibold">
                                  {formatUsd(holding.marketValueMinor)}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {holding.quantity} units
                                </p>
                              </div>
                            </div>
                            <div className="mt-4 flex items-center justify-between gap-4">
                              <Badge
                                variant="outline"
                                className="border-border/80 bg-background/80"
                              >
                                {holding.assetClassLabel}
                              </Badge>
                              <span className="text-sm text-muted-foreground">
                                {formatShare(
                                  holding.marketValueMinor,
                                  visibleTotalMinor,
                                )}{" "}
                                of visible portfolio
                              </span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm leading-6 text-muted-foreground">
                          No holdings match the current filter.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </section>

                <section id="accounts" className="scroll-mt-24 space-y-4">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight">
                      Account sleeves
                    </h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Holdings stay grouped by account so allocation work still
                      maps cleanly back to the imported provider structure.
                    </p>
                  </div>
                  {filteredAccounts.length ? (
                    <div className="grid gap-4 xl:grid-cols-2">
                      {filteredAccounts.map((account) => (
                        <Card
                          id={`account-${account.accountId}`}
                          key={account.accountId}
                          className="scroll-mt-24 border-border/70 bg-card/95 shadow-sm"
                        >
                          <CardHeader className="gap-4">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <CardTitle className="text-xl">
                                  {account.name}
                                </CardTitle>
                                <CardDescription className="mt-1 flex items-center gap-2">
                                  <BuildingsIcon className="size-3.5" />
                                  {account.institutionName}
                                </CardDescription>
                              </div>
                              <div className="text-right">
                                <p className="font-semibold">
                                  {formatUsd(account.marketValueMinor)}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {account.accountType}
                                </p>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <ul className="space-y-3">
                              {account.holdings.map((holding) => (
                                <li
                                  key={holding.holdingId}
                                  className="rounded-[24px] border border-border/70 bg-background/80 p-4"
                                >
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                      <p className="font-medium">
                                        {holding.name}
                                      </p>
                                      <p className="mt-1 text-sm text-muted-foreground">
                                        {[
                                          holding.symbol,
                                          holding.assetClassLabel,
                                        ]
                                          .filter(Boolean)
                                          .join(" · ")}
                                      </p>
                                    </div>
                                    <div className="text-right">
                                      <p className="font-semibold">
                                        {formatUsd(holding.marketValueMinor)}
                                      </p>
                                      <p className="text-sm text-muted-foreground">
                                        {holding.quantity} units
                                      </p>
                                    </div>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <Card className="border-border/70 bg-card/95 shadow-sm">
                      <CardHeader className="gap-2">
                        <CardTitle className="text-xl">
                          No holdings match this filter
                        </CardTitle>
                        <CardDescription className="leading-6">
                          Clear the sidebar search to restore the full portfolio
                          mix.
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  )}
                </section>
              </>
            ) : null}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default function PortfolioRoute({ loaderData }: Route.ComponentProps) {
  return <PortfolioScreen loaderData={loaderData as LoaderData} />;
}
