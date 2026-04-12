import {
  ArrowUpRightIcon,
  CaretDownIcon,
  CaretUpIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import {
  createD1HouseholdAccess,
  createD1HouseholdService,
  getDb,
  type getHomepageSnapshot,
  type HouseholdAccess,
  type HouseholdService,
  type NetWorthHistoryPoint,
  resolveHouseholdSelection,
} from "@vista/db";
import { Area, AreaChart, XAxis, YAxis } from "recharts";

import { DashboardShell } from "@/components/dashboard-shell";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
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
import type { Route } from "./+types/home";

type HomeLoaderDeps = {
  createHouseholdAccess?: (db: ReturnType<typeof getDb>) => HouseholdAccess;
  createHouseholdService?: (
    db: ReturnType<typeof getDb>,
  ) => Pick<HouseholdService, "getHomepageSnapshot">;
  getHomepageSnapshot?: typeof getHomepageSnapshot;
  loadHomepageSnapshot?: (args: {
    env: Env;
    householdId: string;
  }) => Promise<Awaited<ReturnType<typeof getHomepageSnapshot>>>;
  requireViewerContext?: typeof requireViewerContext;
  resolveHouseholdSelection?: typeof resolveHouseholdSelection;
};

// ── Helpers ────────────────────────────────────────────────

function formatChartDate(iso: string) {
  const d = new Date(iso);
  const m = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${m[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function formatChartTooltipDate(iso: string) {
  const d = new Date(iso);
  const m = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${m[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

const chartConfig = {
  netWorth: { label: "Net Worth", color: "var(--primary)" },
} satisfies ChartConfig;

// ── Sub-components ─────────────────────────────────────────

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return null;
  const positive = delta > 0;
  const Icon = positive ? CaretUpIcon : CaretDownIcon;
  return (
    <span
      className={cn(
        "inline-flex max-w-full shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        positive
          ? "bg-emerald-500/15 text-emerald-400"
          : "bg-rose-500/15 text-rose-400",
      )}
    >
      <Icon weight="fill" className="size-3" />
      {formatSignedUsd(delta)}
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
  delta,
}: {
  delta?: number;
  label: string;
  sub?: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          {label}
        </p>
        <div className="mt-2 flex flex-col items-start gap-3">
          <p className="vista-display text-3xl leading-none">{value}</p>
          {delta !== undefined ? <DeltaBadge delta={delta} /> : null}
        </div>
        {sub ? (
          <p className="mt-1.5 text-[13px] text-muted-foreground">{sub}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NetWorthChart({ history }: { history: NetWorthHistoryPoint[] }) {
  if (history.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
        Chart available after multiple syncs
      </div>
    );
  }

  const data = history.map((point) => ({
    ...point,
    netWorthDollars: point.netWorthMinor / 100,
    label: formatChartDate(point.completedAt),
  }));

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          className="text-[10px]"
          interval="preserveStartEnd"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          width={48}
          className="text-[10px]"
          tickFormatter={(v: number) => formatCompactUsd(v * 100)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              hideIndicator
              labelFormatter={(_label, payload) => {
                const item = payload[0];
                if (item?.payload?.completedAt) {
                  return formatChartTooltipDate(item.payload.completedAt);
                }
                return _label;
              }}
              formatter={(value) =>
                typeof value === "number"
                  ? formatUsd(value * 100)
                  : String(value)
              }
            />
          }
        />
        <Area
          dataKey="netWorthDollars"
          type="monotone"
          fill="url(#nwGrad)"
          stroke="var(--primary)"
          strokeWidth={2}
          dot={false}
          name="Net Worth"
        />
      </AreaChart>
    </ChartContainer>
  );
}

const providerMeta = {
  plaid: { name: "Plaid", path: "/connect/plaid" },
} as const;

function isSupportedProvider(
  provider: string,
): provider is keyof typeof providerMeta {
  return provider in providerMeta;
}

type ConnectionState = {
  configuredConnectionCount: number;
  lastSuccessfulSyncAt: null | string;
  latestRunAt: null | string;
  latestRunStatus: "failed" | "never" | "running" | "succeeded";
  provider: string;
  status: "active" | "disconnected" | "error" | "not_connected";
};

function statusOf(s: ConnectionState) {
  if (s.status === "active" && s.latestRunStatus === "succeeded")
    return { color: "bg-emerald-400", label: "Connected" };
  if (s.status === "active" && s.latestRunStatus === "running")
    return { color: "bg-amber-400", label: "Syncing" };
  if (s.status === "active" && s.latestRunStatus === "failed")
    return { color: "bg-rose-400", label: "Error" };
  if (s.status === "active")
    return { color: "bg-emerald-400", label: "Connected" };
  if (s.status === "error") return { color: "bg-rose-400", label: "Error" };
  if (s.status === "disconnected")
    return { color: "bg-amber-400", label: "Disconnected" };
  return { color: "bg-muted-foreground/40", label: "Not connected" };
}

function ProviderRow({
  householdId,
  state,
}: {
  householdId: string;
  state: ConnectionState;
}) {
  if (!isSupportedProvider(state.provider)) {
    return null;
  }

  const provider = providerMeta[state.provider];
  const st = statusOf(state);

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-card/60 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className={cn("size-2 shrink-0 rounded-full", st.color)} />
        <div>
          <p className="text-sm font-medium">{provider.name}</p>
          <p className="text-xs text-muted-foreground">{st.label}</p>
        </div>
      </div>
      <a
        href={buildHouseholdPath(provider.path, householdId)}
        className="text-xs font-medium text-primary hover:underline"
      >
        {state.status === "not_connected" ? "Connect" : "Manage"}
      </a>
    </div>
  );
}

// ── Loader ─────────────────────────────────────────────────

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Vista" },
    { name: "description", content: "Your household finances at a glance." },
  ];
}

function buildLoaderErrorData(title: string, message: string) {
  return {
    kind: "error" as const,
    message,
    title,
  };
}

export function createHomeLoader(deps: HomeLoaderDeps = {}) {
  const requireViewer = deps.requireViewerContext ?? requireViewerContext;
  const createHouseholdAccess =
    deps.createHouseholdAccess ?? createD1HouseholdAccess;
  const createHouseholdService =
    deps.createHouseholdService ?? createD1HouseholdService;
  const loadHomepageSnapshot =
    deps.loadHomepageSnapshot ??
    (deps.getHomepageSnapshot
      ? ({ env, householdId }: { env: Env; householdId: string }) => {
          const getHomepageSnapshot = deps.getHomepageSnapshot;

          if (!getHomepageSnapshot) {
            throw new Error("Homepage snapshot loader is not configured.");
          }

          return getHomepageSnapshot(getDb(env.DB), householdId);
        }
      : ({ env, householdId }: { env: Env; householdId: string }) =>
          createWebRuntimeHouseholdService(env).getHomepageSnapshot(
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
          return {
            kind: "empty" as const,
            nextStepCommand: "bun run db:seed:local",
          };
        }

        const snapshot = await createHouseholdService(db).getHomepageSnapshot(
          household.id,
        );

        if (!snapshot) {
          return {
            kind: "empty" as const,
            nextStepCommand: "bun run db:seed:local",
          };
        }

        return {
          kind: "ready" as const,
          changeSummary: snapshot.changeSummary,
          connectionStates: snapshot.connectionStates
            .filter((state) => isSupportedProvider(state.provider))
            .map((state) => ({
              ...state,
              lastSuccessfulSyncAt:
                state.lastSuccessfulSyncAt?.toISOString() ?? null,
              latestRunAt: state.latestRunAt?.toISOString() ?? null,
            })),
          hasSuccessfulSync: snapshot.hasSuccessfulSync,
          history: snapshot.history,
          historyCoverageMode: snapshot.historyCoverageMode ?? null,
          historyHasEstimatedPoints:
            snapshot.historyHasEstimatedPoints ?? false,
          historyMode: snapshot.historyMode ?? "snapshot",
          householdId: household.id,
          householdName: snapshot.householdName,
          lastSyncedAt: snapshot.lastSyncedAt.toISOString(),
          reportingGroups: snapshot.reportingGroups,
          totals: snapshot.totals,
        };
      }

      const viewer = await requireViewer({ context, request });
      const householdId = resolveViewerHouseholdId(request, viewer.householdId);
      const snapshot = await loadHomepageSnapshot({ env, householdId });

      if (!snapshot) {
        return {
          kind: "empty" as const,
          nextStepCommand: "bun run db:seed:local",
        };
      }

      return {
        kind: "ready" as const,
        changeSummary: snapshot.changeSummary,
        connectionStates: snapshot.connectionStates
          .filter((state) => isSupportedProvider(state.provider))
          .map((state) => ({
            ...state,
            lastSuccessfulSyncAt:
              state.lastSuccessfulSyncAt?.toISOString() ?? null,
            latestRunAt: state.latestRunAt?.toISOString() ?? null,
          })),
        hasSuccessfulSync: snapshot.hasSuccessfulSync,
        history: snapshot.history,
        historyCoverageMode: snapshot.historyCoverageMode ?? null,
        historyHasEstimatedPoints: snapshot.historyHasEstimatedPoints ?? false,
        historyMode: snapshot.historyMode ?? "snapshot",
        householdId,
        householdName: snapshot.householdName,
        lastSyncedAt: snapshot.lastSyncedAt.toISOString(),
        reportingGroups: snapshot.reportingGroups,
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

export const loader = createHomeLoader();

// ── Page ───────────────────────────────────────────────────

export default function Home({ loaderData }: Route.ComponentProps) {
  if (loaderData.kind === "error") {
    return (
      <DashboardShell activePath="/">
        <div className="flex min-h-[80vh] items-center justify-center p-6">
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

  if (loaderData.kind === "empty") {
    return (
      <DashboardShell activePath="/">
        <div className="flex min-h-[80vh] items-center justify-center p-6">
          <div className="max-w-md text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10">
              <WalletIcon className="size-6 text-primary" weight="duotone" />
            </div>
            <h1 className="vista-display mt-6 text-3xl">Welcome to Vista</h1>
            <p className="mt-3 text-muted-foreground">
              Connect your first financial provider to build your household
              snapshot.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a href="/connect/plaid" className={buttonVariants()}>
                Connect Plaid
              </a>
            </div>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const {
    changeSummary,
    connectionStates,
    history,
    householdId,
    historyCoverageMode,
    historyHasEstimatedPoints,
    historyMode,
    householdName,
    lastSyncedAt,
    reportingGroups,
    totals,
  } = loaderData;
  const historyDescription =
    historyMode === "backfilled"
      ? "Backfilled from investment transactions and daily prices"
      : "Historical trajectory across syncs";
  const showMixedCoverageNote =
    historyMode === "backfilled" &&
    historyCoverageMode === "mixed_snapshot_and_backfill";

  return (
    <DashboardShell activePath="/">
      <div className="space-y-6 p-5 lg:p-8">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Welcome back</p>
            <h1 className="vista-display mt-1 text-3xl lg:text-4xl">
              {householdName}
            </h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block size-1.5 rounded-full bg-emerald-400" />
            Synced {formatUpdatedAt(lastSyncedAt)}
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Net worth"
            value={formatUsd(totals.netWorthMinor)}
            delta={changeSummary?.netWorthDeltaMinor}
          />
          <StatCard
            label="Liquid cash"
            value={formatUsd(totals.cashMinor)}
            sub="Checking & savings"
          />
          <StatCard
            label="Investments"
            value={formatUsd(totals.investmentsMinor)}
            sub="Brokerage & retirement"
          />
        </div>

        {/* Chart + accounts */}
        <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Net Worth</CardTitle>
                  <CardDescription>{historyDescription}</CardDescription>
                </div>
                <a
                  href={buildHouseholdPath("/portfolio", householdId)}
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "sm" }),
                    "gap-1 text-xs",
                  )}
                >
                  Portfolio
                  <ArrowUpRightIcon className="size-3" />
                </a>
              </div>
            </CardHeader>
            <CardContent>
              {historyHasEstimatedPoints ? (
                <p className="mb-3 text-xs text-muted-foreground">
                  Includes estimated pricing coverage
                </p>
              ) : null}
              {showMixedCoverageNote ? (
                <p className="mb-3 text-xs text-muted-foreground">
                  Cash and liabilities remain snapshot-backed
                </p>
              ) : null}
              <NetWorthChart history={history} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Accounts</CardTitle>
              <CardDescription>
                {reportingGroups.reduce((sum, g) => sum + g.accounts.length, 0)}{" "}
                accounts tracked
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {reportingGroups.map((group) => (
                <div key={group.key}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {group.label}
                    </p>
                    <p className="text-sm font-semibold tabular-nums">
                      {formatCompactUsd(group.totalMinor)}
                    </p>
                  </div>
                  <div className="mt-2 space-y-0.5">
                    {group.accounts.map((account) => (
                      <div
                        key={account.id}
                        className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-muted/30"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[13px]">{account.name}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {account.institutionName}
                          </p>
                        </div>
                        <p className="shrink-0 text-[13px] font-medium tabular-nums">
                          {formatUsd(account.balanceMinor)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Provider connections */}
        <Card>
          <CardHeader>
            <CardTitle>Connections</CardTitle>
            <CardDescription>Provider status and sync health</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              {connectionStates.map((state) => (
                <ProviderRow
                  key={state.provider}
                  householdId={householdId}
                  state={state}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
