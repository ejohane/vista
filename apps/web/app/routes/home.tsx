import {
  ArrowUpRightIcon,
  CaretDownIcon,
  CaretUpIcon,
  ChartLineUpIcon,
  GearSixIcon,
  HouseLineIcon,
  ListIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import {
  getDb,
  getHomepageSnapshot,
  type NetWorthHistoryPoint,
} from "@vista/db";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { buttonVariants } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  formatCompactUsd,
  formatSignedUsd,
  formatUpdatedAt,
  formatUsd,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Route } from "./+types/home";

const reportingGroupIcons: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  cash: WalletIcon,
  investments: ChartLineUpIcon,
  liabilities: ListIcon,
};

type AccountForDisplay = {
  balanceMinor: number;
  id: string;
  institutionName: string;
  name: string;
};

type ReportingGroupForDisplay = {
  accounts: AccountForDisplay[];
  key: string;
  label: string;
  totalMinor: number;
};

type ConnectionStateForDisplay = {
  configuredConnectionCount: number;
  lastSuccessfulSyncAt: null | string;
  latestRunAt: null | string;
  latestRunStatus: "failed" | "never" | "running" | "succeeded";
  provider: "plaid" | "simplefin" | "snaptrade";
  status: "active" | "disconnected" | "error" | "not_connected";
};

const providerMeta = {
  plaid: {
    eyebrow: "Banking and investing",
    href: "/connect/plaid",
    name: "Plaid",
  },
  simplefin: {
    eyebrow: "Banking",
    href: "/connect/simplefin",
    name: "SimpleFIN",
  },
  snaptrade: {
    eyebrow: "Investing",
    href: "/connect/snaptrade",
    name: "SnapTrade",
  },
} as const;

function formatChartDate(iso: string) {
  const d = new Date(iso);
  const months = [
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
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function formatChartTooltipDate(iso: string) {
  const d = new Date(iso);
  const months = [
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
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

const chartConfig = {
  netWorth: {
    label: "Net Worth",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

function NetWorthChart({ history }: { history: NetWorthHistoryPoint[] }) {
  if (history.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center rounded-2xl border border-border/50 bg-muted/30">
        <p className="text-sm text-muted-foreground">
          Chart available after multiple syncs
        </p>
      </div>
    );
  }

  const data = history.map((point) => ({
    ...point,
    netWorthDollars: point.netWorthMinor / 100,
    label: formatChartDate(point.completedAt),
  }));

  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-auto h-48 w-full sm:h-56 lg:h-64"
    >
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="netWorthGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.2} />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          vertical={false}
          strokeDasharray="3 3"
          className="stroke-border/40"
        />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          className="text-[10px] sm:text-xs"
          interval="preserveStartEnd"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          width={52}
          className="text-[10px] sm:text-xs"
          tickFormatter={(value: number) => formatCompactUsd(value * 100)}
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
              formatter={(value) => {
                if (typeof value === "number") {
                  return formatUsd(value * 100);
                }
                return String(value);
              }}
            />
          }
        />
        <Area
          dataKey="netWorthDollars"
          type="monotone"
          fill="url(#netWorthGradient)"
          stroke="var(--primary)"
          strokeWidth={2}
          dot={false}
          name="Net Worth"
        />
      </AreaChart>
    </ChartContainer>
  );
}

function DeltaIndicator({ deltaMinor }: { deltaMinor: number }) {
  if (deltaMinor === 0) return null;

  const isPositive = deltaMinor > 0;
  const Icon = isPositive ? CaretUpIcon : CaretDownIcon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-sm font-medium",
        isPositive ? "text-emerald-600" : "text-rose-600",
      )}
    >
      <Icon weight="fill" className="size-3.5" />
      {formatSignedUsd(deltaMinor)}
    </span>
  );
}

function AccountRow({ account }: { account: AccountForDisplay }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {account.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {account.institutionName}
        </p>
      </div>
      <p className="shrink-0 text-sm font-semibold tabular-nums">
        {formatUsd(account.balanceMinor)}
      </p>
    </div>
  );
}

function ReportingGroupSection({ group }: { group: ReportingGroupForDisplay }) {
  const Icon = reportingGroupIcons[group.key] ?? WalletIcon;

  return (
    <section>
      <div className="flex items-center justify-between px-1 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-muted">
            <Icon className="size-3.5 text-muted-foreground" />
          </div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {group.label}
          </h3>
        </div>
        <p className="text-sm font-semibold tabular-nums">
          {formatCompactUsd(group.totalMinor)}
        </p>
      </div>
      <div className="rounded-2xl border border-border/60 bg-card/80">
        <div className="divide-y divide-border/50 px-4">
          {group.accounts.map((account) => (
            <AccountRow key={account.id} account={account} />
          ))}
        </div>
      </div>
    </section>
  );
}

function describeConnectionState(state: ConnectionStateForDisplay) {
  const provider = providerMeta[state.provider];
  const configuredLabel =
    state.configuredConnectionCount === 1
      ? "1 live connection"
      : `${state.configuredConnectionCount} live connections`;

  if (state.status === "active") {
    if (state.latestRunStatus === "running" && state.latestRunAt) {
      return {
        actionLabel: `Open ${provider.name}`,
        detail: `${configuredLabel}. Sync started ${formatUpdatedAt(state.latestRunAt)}.`,
        tone: "amber" as const,
        toneLabel: "Syncing",
      };
    }

    if (state.latestRunStatus === "failed" && state.latestRunAt) {
      return {
        actionLabel: `Reconnect ${provider.name}`,
        detail: `${configuredLabel}. Latest sync failed ${formatUpdatedAt(state.latestRunAt)}.`,
        tone: "rose" as const,
        toneLabel: "Needs attention",
      };
    }

    if (state.lastSuccessfulSyncAt) {
      return {
        actionLabel: `Open ${provider.name}`,
        detail: `${configuredLabel}. Last sync ${formatUpdatedAt(state.lastSuccessfulSyncAt)}.`,
        tone: "emerald" as const,
        toneLabel: "Connected",
      };
    }

    return {
      actionLabel: `Open ${provider.name}`,
      detail: `${configuredLabel}. Ready for the first import into Vista.`,
      tone: "emerald" as const,
      toneLabel: "Connected",
    };
  }

  if (state.status === "error") {
    return {
      actionLabel: `Reconnect ${provider.name}`,
      detail: `The ${provider.name} connection needs to be re-authorized before data can flow again.`,
      tone: "rose" as const,
      toneLabel: "Needs attention",
    };
  }

  if (state.status === "disconnected") {
    return {
      actionLabel: `Reconnect ${provider.name}`,
      detail: `Reconnect ${provider.name} to resume imports on the homepage.`,
      tone: "amber" as const,
      toneLabel: "Disconnected",
    };
  }

  return {
    actionLabel: `Connect ${provider.name}`,
    detail: `Connect ${provider.name} to bring live ${provider.eyebrow.toLowerCase()} data into Vista.`,
    tone: "slate" as const,
    toneLabel: "Not connected",
  };
}

function ConnectionCard({ state }: { state: ConnectionStateForDisplay }) {
  const provider = providerMeta[state.provider];
  const presentation = describeConnectionState(state);

  return (
    <div className="rounded-2xl border border-border/60 bg-card/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {provider.eyebrow}
          </p>
          <h3 className="text-base font-semibold tracking-tight">
            {provider.name}
          </h3>
        </div>
        <span
          className={cn(
            "inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest",
            presentation.tone === "emerald" &&
              "bg-emerald-500/10 text-emerald-700",
            presentation.tone === "amber" && "bg-amber-500/10 text-amber-700",
            presentation.tone === "rose" && "bg-rose-500/10 text-rose-700",
            presentation.tone === "slate" && "bg-muted text-muted-foreground",
          )}
        >
          {presentation.toneLabel}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {presentation.detail}
      </p>
      <a
        href={provider.href}
        className={cn(
          buttonVariants({ size: "sm", variant: "outline" }),
          "mt-4 h-8 gap-1.5",
        )}
      >
        {presentation.actionLabel}
        <ArrowUpRightIcon className="size-3" />
      </a>
    </div>
  );
}

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Vista" },
    {
      name: "description",
      content: "Your household finances at a glance.",
    },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  const snapshot = await getHomepageSnapshot(getDb(context.cloudflare.env.DB));

  if (!snapshot) {
    return {
      kind: "empty" as const,
      nextStepCommand: "bun run db:seed:local",
    };
  }

  return {
    kind: "ready" as const,
    changeSummary: snapshot.changeSummary,
    connectionStates: snapshot.connectionStates.map((state) => ({
      ...state,
      lastSuccessfulSyncAt: state.lastSuccessfulSyncAt?.toISOString() ?? null,
      latestRunAt: state.latestRunAt?.toISOString() ?? null,
    })),
    hasSuccessfulSync: snapshot.hasSuccessfulSync,
    history: snapshot.history,
    householdName: snapshot.householdName,
    lastSyncedAt: snapshot.lastSyncedAt.toISOString(),
    reportingGroups: snapshot.reportingGroups,
    totals: snapshot.totals,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  if (loaderData.kind === "empty") {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10">
            <HouseLineIcon className="size-7 text-primary" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Welcome to Vista
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              Seed your database to get started.
            </p>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/40 px-4 py-3">
            <code className="text-sm text-foreground">
              {loaderData.nextStepCommand}
            </code>
          </div>
          <div className="flex flex-col gap-2">
            <a
              href="/connect/plaid"
              className={cn(buttonVariants({ variant: "default" }), "w-full")}
            >
              Connect Plaid
            </a>
            <a
              href="/connect/simplefin"
              className={cn(buttonVariants({ variant: "outline" }), "w-full")}
            >
              Connect SimpleFIN
            </a>
            <a
              href="/connect/snaptrade"
              className={cn(buttonVariants({ variant: "outline" }), "w-full")}
            >
              Connect SnapTrade
            </a>
          </div>
        </div>
      </div>
    );
  }

  const {
    totals,
    changeSummary,
    connectionStates,
    hasSuccessfulSync,
    history,
    householdName,
    reportingGroups,
    lastSyncedAt,
  } = loaderData;

  return (
    <div className="mx-auto min-h-svh w-full max-w-lg px-5 pb-24 pt-safe-top lg:max-w-2xl">
      {/* Top bar */}
      <header className="flex items-center justify-between py-5">
        <h1 className="text-lg font-semibold tracking-tight">Vista</h1>
        <div className="flex items-center gap-1">
          <a
            href="/portfolio"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "h-8 gap-1.5 text-xs",
            )}
          >
            Portfolio
            <ArrowUpRightIcon className="size-3" />
          </a>
          <a
            href="/accounts/review"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "size-8",
            )}
            aria-label="Settings"
          >
            <GearSixIcon className="size-4" />
          </a>
        </div>
      </header>

      {/* Net worth hero */}
      <section className="space-y-1 pb-6">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {householdName}
        </p>
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Net Worth
        </p>
        <div className="flex items-baseline gap-3">
          <h2 className="text-4xl font-bold tabular-nums tracking-tight sm:text-5xl">
            {formatCompactUsd(totals.netWorthMinor)}
          </h2>
          {changeSummary && (
            <DeltaIndicator deltaMinor={changeSummary.netWorthDeltaMinor} />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {hasSuccessfulSync
            ? `Updated ${formatChartDate(lastSyncedAt)}`
            : "Using current account balances while the first sync comes online"}
        </p>
      </section>

      {/* Chart */}
      <section className="pb-8">
        <NetWorthChart history={history} />
      </section>

      {/* Quick stats */}
      <section className="grid grid-cols-3 gap-3 pb-8">
        <div className="rounded-xl border border-border/50 bg-card/80 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Cash
          </p>
          <p className="mt-1 text-base font-bold tabular-nums tracking-tight sm:text-lg">
            {formatCompactUsd(totals.cashMinor)}
          </p>
        </div>
        <div className="rounded-xl border border-border/50 bg-card/80 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Invested
          </p>
          <p className="mt-1 text-base font-bold tabular-nums tracking-tight sm:text-lg">
            {formatCompactUsd(totals.investmentsMinor)}
          </p>
        </div>
        <div className="rounded-xl border border-border/50 bg-card/80 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Accounts
          </p>
          <p className="mt-1 text-base font-bold tabular-nums tracking-tight sm:text-lg">
            {reportingGroups.reduce((s, g) => s + g.accounts.length, 0)}
          </p>
        </div>
      </section>

      {/* Connection state */}
      <section className="grid gap-3 pb-8 sm:grid-cols-2">
        {connectionStates.map((state) => (
          <ConnectionCard key={state.provider} state={state} />
        ))}
      </section>

      {/* Accounts by reporting group */}
      <section className="space-y-6">
        {reportingGroups.map((group) => (
          <ReportingGroupSection key={group.key} group={group} />
        ))}
      </section>
    </div>
  );
}
