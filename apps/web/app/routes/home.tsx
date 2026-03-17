import {
  ArrowsClockwiseIcon,
  BuildingsIcon,
  ChartLineUpIcon,
  CoinsIcon,
  DatabaseIcon,
  HardDrivesIcon,
  PulseIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { getDashboardSnapshot, getDb } from "@vista/db";
import { type ReactNode, useState } from "react";

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
import { formatCompactUsd, formatUpdatedAt, formatUsd } from "@/lib/format";
import type { Route } from "./+types/home";

type AccountGroup = {
  accounts: Array<{
    balanceMinor: number;
    id: string;
    institutionName: string;
    name: string;
  }>;
  key: string;
  label: string;
  totalMinor: number;
};

function getGroupSectionId(key: string) {
  return `group-${key}`;
}

function filterAccountGroups(groups: AccountGroup[], query: string) {
  if (!query) {
    return groups;
  }

  return groups.flatMap((group) => {
    const groupMatches = group.label.toLowerCase().includes(query);
    const accounts = groupMatches
      ? group.accounts
      : group.accounts.filter((account) =>
          `${account.name} ${account.institutionName}`
            .toLowerCase()
            .includes(query),
        );

    if (!accounts.length) {
      return [];
    }

    return [
      {
        ...group,
        accounts,
        totalMinor: accounts.reduce(
          (sum, account) => sum + account.balanceMinor,
          0,
        ),
      },
    ];
  });
}

function MetricCard({
  detail,
  icon,
  label,
  value,
}: {
  detail: string;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card className="border-border/70 bg-card/95 shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="space-y-1">
          <CardDescription className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
            {label}
          </CardDescription>
          <CardTitle className="text-3xl tracking-tight">{value}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-sm leading-6 text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function SignalCard({
  detail,
  icon,
  title,
}: {
  detail: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <Card className="border-border/70 bg-card/95 shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex size-10 items-center justify-center rounded-2xl bg-muted text-foreground">
          {icon}
        </div>
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription className="leading-6">{detail}</CardDescription>
        </div>
      </CardHeader>
    </Card>
  );
}

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Vista | Household Snapshot" },
    {
      name: "description",
      content: "A DB-backed household finance snapshot running on Cloudflare.",
    },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  const db = getDb(context.cloudflare.env.DB);
  const snapshot = await getDashboardSnapshot(db);

  if (!snapshot) {
    return {
      kind: "empty" as const,
      nextStepCommand: "bun run db:seed:local",
    };
  }

  return {
    kind: "ready" as const,
    accountTypeGroups: snapshot.accountTypeGroups,
    householdName: snapshot.householdName,
    lastSyncedAt: snapshot.lastSyncedAt.toISOString(),
    totals: snapshot.totals,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const [searchValue, setSearchValue] = useState("");
  const normalizedSearch = searchValue.trim().toLowerCase();
  const totalAccountCount =
    loaderData.kind === "ready"
      ? loaderData.accountTypeGroups.reduce(
          (sum, group) => sum + group.accounts.length,
          0,
        )
      : 0;
  const filteredGroups =
    loaderData.kind === "ready"
      ? filterAccountGroups(loaderData.accountTypeGroups, normalizedSearch)
      : [];
  const visibleAccountCount =
    loaderData.kind === "ready"
      ? filteredGroups.reduce((sum, group) => sum + group.accounts.length, 0)
      : 0;

  const sidebarSections: AppSidebarSection[] =
    loaderData.kind === "ready"
      ? [
          {
            title: "Snapshot",
            items: [
              {
                badge: "4",
                href: "#metrics",
                isActive: true,
                title: "Key metrics",
              },
              {
                href: "#infrastructure",
                title: "Infrastructure",
              },
            ],
          },
          {
            title: normalizedSearch ? "Matches" : "Account groups",
            items: filteredGroups.length
              ? filteredGroups.map((group) => ({
                  badge: String(group.accounts.length),
                  href: `#${getGroupSectionId(group.key)}`,
                  title: group.label,
                }))
              : [
                  {
                    badge: "0",
                    href: "#accounts",
                    title: "No matching accounts",
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
              {
                href: "#setup",
                title: "Local setup",
              },
              {
                href: "#infrastructure",
                title: "Infrastructure",
              },
            ],
          },
        ];

  const sidebarSummary =
    loaderData.kind === "ready"
      ? [
          {
            label: "Net worth",
            value: formatCompactUsd(loaderData.totals.netWorthMinor),
          },
          {
            label: "Accounts",
            value: `${visibleAccountCount}/${totalAccountCount}`,
          },
        ]
      : [
          {
            label: "Next step",
            value: "Seed D1",
          },
          {
            label: "Status",
            value: "Worker up",
          },
        ];

  const readyMetrics =
    loaderData.kind === "ready"
      ? [
          {
            detail: "Everything currently loaded into the local snapshot.",
            icon: <ChartLineUpIcon className="size-5" />,
            label: "Net worth",
            value: formatCompactUsd(loaderData.totals.netWorthMinor),
          },
          {
            detail: "Checking and savings accounts available right now.",
            icon: <WalletIcon className="size-5" />,
            label: "Cash",
            value: formatCompactUsd(loaderData.totals.cashMinor),
          },
          {
            detail: "Brokerage and retirement balances from the snapshot.",
            icon: <CoinsIcon className="size-5" />,
            label: "Investments",
            value: formatCompactUsd(loaderData.totals.investmentsMinor),
          },
          {
            detail: "Visible accounts after the sidebar search filter.",
            icon: <BuildingsIcon className="size-5" />,
            label: "Visible accounts",
            value: String(visibleAccountCount),
          },
        ]
      : [];

  return (
    <SidebarProvider defaultOpen>
      <AppSidebar
        helperText={
          loaderData.kind === "ready"
            ? normalizedSearch
              ? `Filtering account cards for "${searchValue}".`
              : `Synced ${formatUpdatedAt(loaderData.lastSyncedAt)}.`
            : `Run ${loaderData.nextStepCommand} and refresh the page.`
        }
        onSearchValueChange={setSearchValue}
        searchDisabled={loaderData.kind === "empty"}
        searchPlaceholder={
          loaderData.kind === "ready"
            ? "Search accounts or institutions..."
            : "Snapshot data required"
        }
        searchValue={searchValue}
        sections={sidebarSections}
        status={loaderData.kind}
        subtitle={
          loaderData.kind === "ready"
            ? `Updated ${formatUpdatedAt(loaderData.lastSyncedAt)}`
            : "Awaiting the first local snapshot"
        }
        summary={sidebarSummary}
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
                <span className="text-muted-foreground">Vista</span>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>
                  {loaderData.kind === "ready"
                    ? loaderData.householdName
                    : "Household snapshot"}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <main className="relative flex flex-1 flex-col overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(226,91,36,0.14),_transparent_32%),linear-gradient(180deg,_rgba(255,255,255,1)_0%,_rgba(250,248,245,1)_58%,_rgba(245,241,237,0.96)_100%)]" />
          <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
            {loaderData.kind === "ready" ? (
              <>
                <section
                  id="metrics"
                  className="grid scroll-mt-24 gap-4 md:grid-cols-2 2xl:grid-cols-4"
                >
                  {readyMetrics.map((metric) => (
                    <MetricCard
                      key={metric.label}
                      detail={metric.detail}
                      icon={metric.icon}
                      label={metric.label}
                      value={metric.value}
                    />
                  ))}
                </section>

                <section id="accounts" className="scroll-mt-24 space-y-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div>
                      <h2 className="text-2xl font-semibold tracking-tight">
                        Account groups
                      </h2>
                      <p className="text-sm leading-6 text-muted-foreground">
                        Each card mirrors a sidebar section and keeps the
                        visible totals aligned with the current filter.
                      </p>
                    </div>
                    {normalizedSearch ? (
                      <Badge
                        variant="outline"
                        className="w-fit border-border/80 bg-background/80"
                      >
                        Query: {searchValue}
                      </Badge>
                    ) : null}
                  </div>
                  {filteredGroups.length ? (
                    <div className="grid gap-4 xl:grid-cols-2">
                      {filteredGroups.map((group) => (
                        <Card
                          id={getGroupSectionId(group.key)}
                          key={group.key}
                          className="scroll-mt-24 border-border/70 bg-card/95 shadow-sm"
                        >
                          <CardHeader className="gap-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <CardTitle className="text-xl">
                                  {group.label}
                                </CardTitle>
                                <CardDescription className="mt-1">
                                  {group.accounts.length} visible account
                                  {group.accounts.length === 1 ? "" : "s"}
                                </CardDescription>
                              </div>
                              <Badge
                                variant="outline"
                                className="w-fit border-border/80 bg-background/80"
                              >
                                {formatUsd(group.totalMinor)}
                              </Badge>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <ul className="space-y-3">
                              {group.accounts.map((account, index) => (
                                <li
                                  key={account.id}
                                  className={
                                    index === 0
                                      ? "rounded-2xl border border-border/70 bg-background/75 p-4"
                                      : "rounded-2xl border border-border/70 bg-background/75 p-4"
                                  }
                                >
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                      <p className="font-medium">
                                        {account.name}
                                      </p>
                                      <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                                        <BuildingsIcon className="size-3.5" />
                                        {account.institutionName}
                                      </p>
                                    </div>
                                    <p className="shrink-0 text-sm font-semibold">
                                      {formatUsd(account.balanceMinor)}
                                    </p>
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
                          No accounts match this filter
                        </CardTitle>
                        <CardDescription className="leading-6">
                          Try a broader institution name or clear the sidebar
                          search to restore the full snapshot.
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  )}
                </section>

                <section id="infrastructure" className="scroll-mt-24 space-y-4">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight">
                      Infrastructure
                    </h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      The data path now has a cleaner presentation, but the same
                      worker, D1, and shared package wiring remains intact.
                    </p>
                  </div>
                  <div className="grid gap-4 xl:grid-cols-3">
                    <SignalCard
                      detail="React Router server rendering still runs through the Cloudflare Worker entrypoint."
                      icon={<PulseIcon className="size-5" />}
                      title="Worker runtime"
                    />
                    <SignalCard
                      detail="Snapshot data is sourced from D1 through the shared query layer in the workspace package."
                      icon={<DatabaseIcon className="size-5" />}
                      title="D1 as source of record"
                    />
                    <SignalCard
                      detail="Both the sync worker and the web app depend on the same schema and formatting utilities."
                      icon={<HardDrivesIcon className="size-5" />}
                      title="Shared package contract"
                    />
                  </div>
                </section>
              </>
            ) : (
              <>
                <section
                  id="overview"
                  className="grid scroll-mt-24 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.8fr)]"
                >
                  <Card className="border-border/70 bg-card/95 shadow-sm">
                    <CardHeader className="gap-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="bg-primary text-primary-foreground">
                          Backend connected
                        </Badge>
                        <Badge
                          variant="outline"
                          className="border-border/80 bg-background/70"
                        >
                          Awaiting snapshot data
                        </Badge>
                      </div>
                      <div className="space-y-3">
                        <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">
                          Sidebar dashboard rewrite
                        </p>
                        <CardTitle className="text-4xl tracking-tight sm:text-5xl">
                          Household snapshot not ready yet
                        </CardTitle>
                        <CardDescription className="max-w-3xl text-base leading-7 text-muted-foreground">
                          The UI shell is now in place, but D1 does not have a
                          household snapshot to render. Seed the local database,
                          refresh the route, and the sidebar navigation will
                          switch to the live account view automatically.
                        </CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
                        <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                          Required command
                        </p>
                        <p className="mt-4 text-2xl font-semibold tracking-tight">
                          Seed the local DB
                        </p>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          Run{" "}
                          <code className="rounded-full bg-muted px-2 py-1 text-foreground">
                            {loaderData.nextStepCommand}
                          </code>{" "}
                          to load a sample household snapshot into local D1.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
                        <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                          What appears next
                        </p>
                        <p className="mt-4 text-2xl font-semibold tracking-tight">
                          Sidebar-driven dashboard
                        </p>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          Totals, grouped accounts, sync timing, and the new
                          search-based filtering all render as soon as the first
                          snapshot exists.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 bg-primary/[0.04] shadow-sm">
                    <CardHeader className="gap-3">
                      <div className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                        <ArrowsClockwiseIcon className="size-5" />
                      </div>
                      <div className="space-y-1">
                        <CardTitle className="text-lg">
                          Ready to hydrate
                        </CardTitle>
                        <CardDescription className="leading-6">
                          The sidebar chrome, responsive sheet behavior, and the
                          homepage content structure are already installed.
                        </CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent className="grid gap-3">
                      <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                        <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                          Next action
                        </p>
                        <p className="mt-3 text-2xl font-semibold tracking-tight">
                          1 command
                        </p>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                        <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                          Expected state
                        </p>
                        <p className="mt-3 text-sm leading-6 text-muted-foreground">
                          The hero card and sidebar summary will flip from setup
                          guidance to live balances after the first seed.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </section>

                <section id="setup" className="scroll-mt-24 space-y-4">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight">
                      Local setup
                    </h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      The data dependency is narrow. Once D1 contains a
                      household row, the rest of the page is already wired.
                    </p>
                  </div>
                  <div className="grid gap-4 xl:grid-cols-3">
                    <MetricCard
                      detail="Populate local D1 with the sample household data used by the dashboard."
                      icon={<DatabaseIcon className="size-5" />}
                      label="Step 1"
                      value="Seed D1"
                    />
                    <MetricCard
                      detail="Optionally run the sync worker path if you want to validate the end-to-end import flow."
                      icon={<ArrowsClockwiseIcon className="size-5" />}
                      label="Step 2"
                      value="Run sync"
                    />
                    <MetricCard
                      detail="Refresh this route to let the loader pull grouped totals and account balances."
                      icon={<PulseIcon className="size-5" />}
                      label="Step 3"
                      value="Reload page"
                    />
                  </div>
                </section>

                <section id="infrastructure" className="scroll-mt-24 space-y-4">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight">
                      Infrastructure
                    </h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      The app runtime is healthy. The only missing ingredient is
                      snapshot data in D1.
                    </p>
                  </div>
                  <div className="grid gap-4 xl:grid-cols-3">
                    <SignalCard
                      detail="React Router server rendering reaches the worker entrypoint successfully."
                      icon={<PulseIcon className="size-5" />}
                      title="Worker runtime"
                    />
                    <SignalCard
                      detail="The loader can reach the shared DB package, but the snapshot query currently returns no row."
                      icon={<DatabaseIcon className="size-5" />}
                      title="D1 wiring"
                    />
                    <SignalCard
                      detail="Once seeded, this same layout will show grouped balances without another UI pass."
                      icon={<HardDrivesIcon className="size-5" />}
                      title="Dashboard shell ready"
                    />
                  </div>
                </section>
              </>
            )}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
