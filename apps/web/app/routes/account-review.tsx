import {
  EyeSlashIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";
import {
  type AccountCurationSnapshot,
  getAccountCurationSnapshot,
  getDb,
  ownershipTypes,
  updateAccountCuration,
} from "@vista/db";
import { useDeferredValue, useState } from "react";
import { redirect, useFetcher } from "react-router";

import { DashboardShell } from "@/components/dashboard-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireViewerContext } from "@/lib/auth.server";
import { formatCompactUsd, formatUpdatedAt, formatUsd } from "@/lib/format";
import { readCloudflareEnv } from "@/lib/server-context";
import { cn } from "@/lib/utils";
import type { Route } from "./+types/account-review";

/* ------------------------------------------------------------------ */
/*  Constants & types                                                  */
/* ------------------------------------------------------------------ */

const accountTypeLabels: Record<string, string> = {
  brokerage: "Brokerage",
  checking: "Checking",
  credit_card: "Credit Card",
  line_of_credit: "Line of Credit",
  loan: "Loan",
  mortgage: "Mortgage",
  retirement: "Retirement",
  savings: "Savings",
  student_loan: "Student Loan",
};

const ownershipLabels: Record<string, string> = {
  joint: "Joint",
  mine: "Mine",
  wife: "Wife",
};

type ReportingGroup = "cash" | "investments" | "liabilities";
type OwnershipOption = (typeof ownershipTypes)[number];
type ReadyAccount = AccountCurationSnapshot["accounts"][number];
type ActionData = {
  accountId?: string;
  message: string;
  ok: false;
};
type LoaderData = Route.ComponentProps["loaderData"];

type FilterGroup = "all" | ReportingGroup;
type SortOption =
  | "balance-asc"
  | "balance-desc"
  | "default"
  | "name-asc"
  | "name-desc"
  | "type";

const sortLabels: Record<SortOption, string> = {
  "balance-asc": "Balance (low \u2192 high)",
  "balance-desc": "Balance (high \u2192 low)",
  default: "Default",
  "name-asc": "Name A\u2192Z",
  "name-desc": "Name Z\u2192A",
  type: "Type",
};

const groupBadgeColors: Record<ReportingGroup, string> = {
  cash: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  investments: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  liabilities: "border-rose-500/20 bg-rose-500/10 text-rose-400",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function filterAccounts(
  accounts: ReadyAccount[],
  group: FilterGroup,
  query: string,
) {
  let filtered = accounts;
  if (group !== "all") {
    filtered = filtered.filter((a) => a.reportingGroup === group);
  }
  if (query) {
    filtered = filtered.filter((a) =>
      [
        a.displayName,
        a.name,
        a.institutionName,
        accountTypeLabels[a.accountType],
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }
  return filtered;
}

function sortAccounts(
  accounts: ReadyAccount[],
  sort: SortOption,
): ReadyAccount[] {
  if (sort === "default") return accounts;
  return [...accounts].sort((a, b) => {
    switch (sort) {
      case "balance-desc":
        return b.balanceMinor - a.balanceMinor;
      case "balance-asc":
        return a.balanceMinor - b.balanceMinor;
      case "name-asc":
        return (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name);
      case "name-desc":
        return (b.displayName ?? b.name).localeCompare(a.displayName ?? a.name);
      case "type":
        return a.accountType.localeCompare(b.accountType);
      default:
        return 0;
    }
  });
}

function computeSummary(accounts: ReadyAccount[]) {
  const balances: Record<ReportingGroup, number> = {
    cash: 0,
    investments: 0,
    liabilities: 0,
  };
  const counts = {
    cash: 0,
    included: 0,
    investments: 0,
    liabilities: 0,
    total: accounts.length,
  };
  for (const a of accounts) {
    const g = a.reportingGroup;
    balances[g] += a.balanceMinor;
    counts[g]++;
    if (a.includeInHouseholdReporting) counts.included++;
  }
  return { balances, counts };
}

/* ------------------------------------------------------------------ */
/*  Small UI pieces                                                    */
/* ------------------------------------------------------------------ */

function ToggleSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        disabled && "cursor-not-allowed opacity-50",
        checked ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "pointer-events-none block size-3.5 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}

function TypeBadge({
  accountType,
  reportingGroup,
}: {
  accountType: string;
  reportingGroup: ReportingGroup;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none",
        groupBadgeColors[reportingGroup],
      )}
    >
      {accountTypeLabels[accountType] ?? accountType}
    </span>
  );
}

function SummaryCard({
  color,
  detail,
  label,
  value,
}: {
  color?: string;
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
        <p className={cn("mt-2 text-2xl font-semibold tabular-nums", color)}>
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Account row                                                        */
/* ------------------------------------------------------------------ */

function AccountRow({ account }: { account: ReadyAccount }) {
  const fetcher = useFetcher();
  const [expanded, setExpanded] = useState(false);
  const [localDisplayName, setLocalDisplayName] = useState(
    account.displayName ?? "",
  );
  const isSubmitting = fetcher.state !== "idle";

  const optimistic =
    isSubmitting && fetcher.formData
      ? {
          includeInHouseholdReporting:
            fetcher.formData.get("includeInHouseholdReporting") === "on",
          isHidden: fetcher.formData.get("isHidden") === "on",
          ownershipType: fetcher.formData.get(
            "ownershipType",
          ) as OwnershipOption,
        }
      : null;

  const displayOwnership = optimistic?.ownershipType ?? account.ownershipType;
  const displayIncluded =
    optimistic?.includeInHouseholdReporting ??
    account.includeInHouseholdReporting;
  const displayHidden = optimistic?.isHidden ?? account.isHidden;
  const effectiveName = account.displayName ?? account.name;

  const submitChange = (changes: {
    displayName?: string;
    includeInHouseholdReporting?: boolean;
    isHidden?: boolean;
    ownershipType?: string;
  }) => {
    const data: Record<string, string> = {
      accountId: account.id,
      displayName: changes.displayName ?? localDisplayName ?? "",
      intent: "inline",
      ownershipType: changes.ownershipType ?? account.ownershipType,
    };
    const included =
      changes.includeInHouseholdReporting ??
      account.includeInHouseholdReporting;
    if (included) data.includeInHouseholdReporting = "on";
    const hidden = changes.isHidden ?? account.isHidden;
    if (hidden) data.isHidden = "on";
    fetcher.submit(data, { method: "post" });
  };

  const balanceColor =
    account.reportingGroup === "liabilities" || account.balanceMinor < 0
      ? "text-rose-400"
      : "";

  return (
    <div
      className={cn(
        "border-b border-border/20 transition-colors last:border-b-0",
        !displayIncluded && "opacity-50",
      )}
    >
      {/* Main row */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5 hover:bg-muted/10">
        {/* Account info */}
        <div className="min-w-[180px] flex-1">
          <div className="flex items-center gap-2.5">
            <span className="truncate font-medium">{effectiveName}</span>
            <TypeBadge
              accountType={account.accountType}
              reportingGroup={account.reportingGroup}
            />
            {displayHidden ? (
              <EyeSlashIcon className="size-3.5 text-muted-foreground/60" />
            ) : null}
            {isSubmitting ? (
              <SpinnerGapIcon className="size-3.5 animate-spin text-primary" />
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {account.institutionName}
          </p>
        </div>

        {/* Balance */}
        <div
          className={cn(
            "w-32 text-right text-base font-semibold tabular-nums",
            balanceColor,
          )}
        >
          {formatUsd(account.balanceMinor)}
        </div>

        {/* Ownership */}
        <select
          value={displayOwnership}
          onChange={(e) => submitChange({ ownershipType: e.target.value })}
          disabled={isSubmitting}
          className="h-8 w-20 rounded-lg border border-border/40 bg-card/60 px-2 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        >
          {ownershipTypes.map((o) => (
            <option key={o} value={o}>
              {ownershipLabels[o] ?? o}
            </option>
          ))}
        </select>

        {/* Include toggle */}
        <div className="flex items-center gap-2">
          <ToggleSwitch
            checked={displayIncluded}
            disabled={isSubmitting}
            onChange={(v) => submitChange({ includeInHouseholdReporting: v })}
          />
          <span className="hidden text-xs text-muted-foreground/70 sm:inline">
            {displayIncluded ? "Included" : "Excluded"}
          </span>
        </div>

        {/* Edit button */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
            expanded && "bg-muted/50 text-foreground",
          )}
        >
          <PencilSimpleIcon className="size-3.5" />
        </button>
      </div>

      {/* Expanded edit panel */}
      {expanded ? (
        <div className="border-t border-border/10 bg-muted/5 px-5 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] max-w-sm flex-1 space-y-1">
              <label
                htmlFor={`${account.id}_displayName`}
                className="text-xs text-muted-foreground"
              >
                Display name
              </label>
              <Input
                id={`${account.id}_displayName`}
                value={localDisplayName}
                onChange={(e) =>
                  setLocalDisplayName((e.target as HTMLInputElement).value)
                }
                placeholder={account.name}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={displayHidden}
                onChange={(e) =>
                  submitChange({
                    isHidden: (e.target as HTMLInputElement).checked,
                  })
                }
                disabled={isSubmitting}
                className="size-4 rounded border-border"
              />
              <span className="text-xs text-muted-foreground">
                Hidden from snapshot
              </span>
            </label>
            <Button
              size="sm"
              disabled={isSubmitting}
              onClick={() => {
                submitChange({ displayName: localDisplayName });
                setExpanded(false);
              }}
            >
              {isSubmitting ? "Saving\u2026" : "Save name"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Vista | Household Accounts" },
    {
      content:
        "See every household account, sort by type, and manage ownership and Vista inclusion.",
      name: "description",
    },
  ];
}

export function createAccountReviewLoader(deps?: {
  getAccountCurationSnapshot?: typeof getAccountCurationSnapshot;
  requireViewerContext?: typeof requireViewerContext;
}) {
  const loadAccountCurationSnapshot =
    deps?.getAccountCurationSnapshot ?? getAccountCurationSnapshot;
  const requireViewer = deps?.requireViewerContext ?? requireViewerContext;

  return async function loader({ context, request }: Route.LoaderArgs) {
    const viewer = await requireViewer({ context, request });
    const env = readCloudflareEnv(context);
    const snapshot = await loadAccountCurationSnapshot(
      getDb(env.DB),
      viewer.householdId,
    );
    const updatedAccountId = new URL(request.url).searchParams.get("updated");

    if (!snapshot) {
      return { kind: "empty" as const, updatedAccountId };
    }

    return {
      accounts: snapshot.accounts,
      householdName: snapshot.householdName,
      kind: "ready" as const,
      lastSyncedAt: snapshot.lastSyncedAt.toISOString(),
      summary: snapshot.summary,
      updatedAccountId,
    };
  };
}

export function createAccountReviewAction(deps?: {
  requireViewerContext?: typeof requireViewerContext;
  updateAccountCuration?: typeof updateAccountCuration;
}) {
  const requireViewer = deps?.requireViewerContext ?? requireViewerContext;
  const saveAccountCuration =
    deps?.updateAccountCuration ?? updateAccountCuration;

  return async function action({ context, request }: Route.ActionArgs) {
    const viewer = await requireViewer({ context, request });
    const env = readCloudflareEnv(context);
    const formData = await request.formData();
    const accountId = formData.get("accountId");
    const displayName = formData.get("displayName");
    const ownershipType = formData.get("ownershipType");
    const intent = formData.get("intent");

    if (typeof accountId !== "string" || !accountId.trim()) {
      return {
        message: "Choose an account before saving curation changes.",
        ok: false,
      } satisfies ActionData;
    }

    if (
      typeof ownershipType !== "string" ||
      !ownershipTypes.includes(ownershipType as OwnershipOption)
    ) {
      return {
        accountId,
        message: "Select a supported ownership label before saving.",
        ok: false,
      } satisfies ActionData;
    }

    const resolvedOwnershipType = ownershipType as OwnershipOption;

    try {
      await saveAccountCuration(getDb(env.DB), {
        accountId,
        displayName: typeof displayName === "string" ? displayName : null,
        householdId: viewer.householdId,
        includeInHouseholdReporting:
          formData.get("includeInHouseholdReporting") === "on",
        isHidden: formData.get("isHidden") === "on",
        ownershipType: resolvedOwnershipType,
      });

      if (intent === "inline") {
        return { accountId, ok: true as const };
      }

      return redirect(
        `/accounts/review?updated=${encodeURIComponent(accountId)}`,
      );
    } catch (error) {
      return {
        accountId,
        message:
          error instanceof Error
            ? error.message
            : "Account curation failed unexpectedly.",
        ok: false,
      } satisfies ActionData;
    }
  };
}

export const loader = createAccountReviewLoader();
export const action = createAccountReviewAction();

/* ------------------------------------------------------------------ */
/*  Main screen                                                        */
/* ------------------------------------------------------------------ */

export function AccountReviewScreen({
  loaderData,
}: {
  loaderData: LoaderData;
}) {
  const [searchValue, setSearchValue] = useState("");
  const [filterGroup, setFilterGroup] = useState<FilterGroup>("all");
  const [sortOption, setSortOption] = useState<SortOption>("default");
  const deferredSearch = useDeferredValue(searchValue);
  const normalizedSearch = deferredSearch.trim().toLowerCase();

  if (loaderData.kind !== "ready") {
    return (
      <DashboardShell activePath="/accounts/review">
        <div className="space-y-6 p-5 lg:p-8">
          <div>
            <p className="text-sm text-muted-foreground">Account Management</p>
            <h1 className="vista-display mt-1 text-3xl lg:text-4xl">
              Accounts
            </h1>
          </div>
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-lg font-medium">No accounts imported yet</p>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Connect a provider or seed local data first.
              </p>
              <div className="mt-6 flex gap-3">
                <a href="/connect/plaid" className={buttonVariants()}>
                  Connect Plaid
                </a>
                <a href="/" className={buttonVariants({ variant: "outline" })}>
                  Back to overview
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </DashboardShell>
    );
  }

  const { accounts, householdName, lastSyncedAt } = loaderData;
  const stats = computeSummary(accounts);
  const filtered = filterAccounts(accounts, filterGroup, normalizedSearch);
  const sorted = sortAccounts(filtered, sortOption);

  const filterGroups: { count: number; key: FilterGroup; label: string }[] = [
    { count: stats.counts.total, key: "all", label: "All" },
    { count: stats.counts.cash, key: "cash", label: "Cash" },
    {
      count: stats.counts.investments,
      key: "investments",
      label: "Investments",
    },
    {
      count: stats.counts.liabilities,
      key: "liabilities",
      label: "Liabilities",
    },
  ];

  return (
    <DashboardShell activePath="/accounts/review">
      <div className="space-y-6 p-5 lg:p-8">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{householdName}</p>
            <h1 className="vista-display mt-1 text-3xl lg:text-4xl">
              Accounts
            </h1>
          </div>
          <div className="text-xs text-muted-foreground">
            Updated {formatUpdatedAt(lastSyncedAt)}
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            label="Total Accounts"
            value={String(stats.counts.total)}
            detail={`${stats.counts.included} included in Vista`}
          />
          <SummaryCard
            color="text-emerald-400"
            detail={`${stats.counts.cash} accounts`}
            label="Cash"
            value={formatCompactUsd(stats.balances.cash)}
          />
          <SummaryCard
            color="text-amber-400"
            detail={`${stats.counts.investments} accounts`}
            label="Investments"
            value={formatCompactUsd(stats.balances.investments)}
          />
          <SummaryCard
            color="text-rose-400"
            detail={`${stats.counts.liabilities} accounts`}
            label="Liabilities"
            value={formatCompactUsd(stats.balances.liabilities)}
          />
        </div>

        {/* Filter & sort bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1.5">
            {filterGroups.map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => setFilterGroup(g.key)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  filterGroup === g.key
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {g.label}
                <span className="ml-1.5 opacity-60">{g.count}</span>
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as SortOption)}
              className="h-8 rounded-lg border border-border/40 bg-card/60 px-2 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            >
              {(Object.keys(sortLabels) as SortOption[]).map((key) => (
                <option key={key} value={key}>
                  {sortLabels[key]}
                </option>
              ))}
            </select>

            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
              <input
                type="text"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder="Search accounts\u2026"
                className="h-8 w-44 rounded-lg border border-border/40 bg-card/60 pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground/50 focus:border-ring focus:ring-2 focus:ring-ring/30"
              />
            </div>
          </div>
        </div>

        {/* Account list */}
        {sorted.length > 0 ? (
          <Card className="overflow-hidden py-0">
            {/* Column headers (desktop) */}
            <div className="hidden items-center gap-5 border-b border-border/30 px-5 py-2.5 lg:flex">
              <span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                Account
              </span>
              <span className="w-32 text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                Balance
              </span>
              <span className="w-20 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                Owner
              </span>
              <span className="w-[106px] text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                Status
              </span>
              <span className="w-7" />
            </div>

            {sorted.map((account) => (
              <AccountRow key={account.id} account={account} />
            ))}
          </Card>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-sm text-muted-foreground">
                {normalizedSearch
                  ? "No accounts match your search"
                  : "No accounts in this category"}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardShell>
  );
}

export default function AccountReview({ loaderData }: Route.ComponentProps) {
  return <AccountReviewScreen loaderData={loaderData} />;
}
