import {
  EyeSlashIcon,
  FunnelSimpleXIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import {
  getAccountCurationSnapshot,
  getDb,
  ownershipTypes,
  updateAccountCuration,
} from "@vista/db";
import { type ReactNode, useDeferredValue, useState } from "react";
import { redirect, useActionData, useNavigation } from "react-router";

import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUpdatedAt, formatUsd } from "@/lib/format";
import type { Route } from "./+types/account-review";

const accountTypeLabels = {
  brokerage: "Brokerage",
  checking: "Checking",
  credit_card: "Credit Card",
  retirement: "Retirement",
  savings: "Savings",
} as const;

type OwnershipOption = (typeof ownershipTypes)[number];
type ReadyAccount = {
  accountType: keyof typeof accountTypeLabels;
  balanceMinor: number;
  displayName: null | string;
  id: string;
  includeInHouseholdReporting: boolean;
  institutionName: string;
  isHidden: boolean;
  name: string;
  ownershipType: OwnershipOption;
};
type ActionData = {
  accountId?: string;
  message: string;
  ok: false;
};
type LoaderData = Route.ComponentProps["loaderData"];

function groupAccounts(accounts: ReadyAccount[]) {
  const groups = new Map<
    keyof typeof accountTypeLabels,
    {
      accounts: ReadyAccount[];
      key: keyof typeof accountTypeLabels;
      label: string;
    }
  >();

  for (const account of accounts) {
    const existing = groups.get(account.accountType);
    if (existing) {
      existing.accounts.push(account);
      continue;
    }
    groups.set(account.accountType, {
      accounts: [account],
      key: account.accountType,
      label: accountTypeLabels[account.accountType],
    });
  }

  return Array.from(groups.values());
}

function filterAccounts(accounts: ReadyAccount[], query: string) {
  if (!query) return accounts;

  return accounts.filter((account) =>
    [
      account.displayName,
      account.name,
      account.institutionName,
      accountTypeLabels[account.accountType],
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}

function checkboxNameFor(accountId: string, field: "hidden" | "reporting") {
  return `${accountId}_${field}`;
}

function SummaryCard({
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
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-primary">
          {icon}
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </p>
        </div>
        <p className="mt-3 text-2xl font-semibold tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Vista | Account Review" },
    {
      name: "description",
      content:
        "Review imported accounts, rename them, set ownership, and control reporting visibility.",
    },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const snapshot = await getAccountCurationSnapshot(
    getDb(context.cloudflare.env.DB),
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
}

export async function action({ context, request }: Route.ActionArgs) {
  const formData = await request.formData();
  const accountId = formData.get("accountId");
  const displayName = formData.get("displayName");
  const ownershipType = formData.get("ownershipType");

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
    await updateAccountCuration(getDb(context.cloudflare.env.DB), {
      accountId,
      displayName: typeof displayName === "string" ? displayName : null,
      includeInHouseholdReporting:
        formData.get("includeInHouseholdReporting") === "on",
      isHidden: formData.get("isHidden") === "on",
      ownershipType: resolvedOwnershipType,
    });

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
}

export function AccountReviewScreen({
  activeSaveAccountId,
  actionData,
  loaderData,
}: {
  activeSaveAccountId: null | string;
  actionData?: ActionData;
  loaderData: LoaderData;
}) {
  const [searchValue, setSearchValue] = useState("");
  const deferredSearch = useDeferredValue(searchValue);
  const normalizedSearch = deferredSearch.trim().toLowerCase();
  const filteredAccounts =
    loaderData.kind === "ready"
      ? filterAccounts(loaderData.accounts, normalizedSearch)
      : [];
  const groupedAccounts = groupAccounts(filteredAccounts);
  const updatedAccount =
    loaderData.kind === "ready" && loaderData.updatedAccountId
      ? loaderData.accounts.find((a) => a.id === loaderData.updatedAccountId)
      : null;

  return (
    <DashboardShell activePath="/accounts/review">
      <div className="space-y-6 p-5 lg:p-8">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">
              {loaderData.kind === "ready"
                ? loaderData.householdName
                : "Account Review"}
            </p>
            <h1 className="vista-display mt-1 text-3xl lg:text-4xl">
              Account Curation
            </h1>
          </div>
          {loaderData.kind === "ready" ? (
            <div className="text-xs text-muted-foreground">
              Updated {formatUpdatedAt(loaderData.lastSyncedAt)}
            </div>
          ) : null}
        </div>

        {loaderData.kind === "empty" ? (
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
        ) : (
          <>
            {/* Summary cards + search */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2 lg:col-span-1">
                <div className="relative">
                  <input
                    type="text"
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    placeholder="Search accounts..."
                    className="h-10 w-full rounded-lg border border-border/60 bg-card/60 px-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-2 focus:ring-ring/30"
                  />
                </div>
              </div>
              <SummaryCard
                detail="Counted in household totals"
                icon={<ShieldCheckIcon className="size-4" />}
                label="Included"
                value={String(loaderData.summary.includedCount)}
              />
              <SummaryCard
                detail="Hidden from snapshot view"
                icon={<EyeSlashIcon className="size-4" />}
                label="Hidden"
                value={String(loaderData.summary.hiddenCount)}
              />
              <SummaryCard
                detail="Excluded from reporting"
                icon={<FunnelSimpleXIcon className="size-4" />}
                label="Excluded"
                value={String(loaderData.summary.excludedCount)}
              />
            </div>

            {/* Success/error messages */}
            {updatedAccount ? (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                Saved changes for{" "}
                {updatedAccount.displayName ?? updatedAccount.name}.
              </div>
            ) : null}
            {actionData ? (
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                {actionData.message}
              </div>
            ) : null}

            {/* Account groups */}
            {groupedAccounts.length ? (
              <div className="space-y-6">
                {groupedAccounts.map((group) => (
                  <div key={group.key}>
                    <h2 className="mb-3 text-lg font-semibold">
                      {group.label}
                    </h2>
                    <div className="grid gap-4 xl:grid-cols-2">
                      {group.accounts.map((account) => {
                        const effectiveName =
                          account.displayName ?? account.name;
                        const isSaving = activeSaveAccountId === account.id;

                        return (
                          <Card key={account.id}>
                            <CardHeader>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <CardTitle className="text-base">
                                    {effectiveName}
                                  </CardTitle>
                                  <CardDescription>
                                    {account.institutionName} ·{" "}
                                    {formatUsd(account.balanceMinor)}
                                  </CardDescription>
                                </div>
                                <div className="flex gap-1">
                                  {!account.includeInHouseholdReporting ? (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px]"
                                    >
                                      Excluded
                                    </Badge>
                                  ) : null}
                                  {account.isHidden ? (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px]"
                                    >
                                      Hidden
                                    </Badge>
                                  ) : null}
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent>
                              <form method="post" className="space-y-4">
                                <input
                                  type="hidden"
                                  name="accountId"
                                  value={account.id}
                                />
                                <div className="grid gap-4 sm:grid-cols-2">
                                  <div className="space-y-1.5">
                                    <Label
                                      htmlFor={`${account.id}_displayName`}
                                      className="text-xs"
                                    >
                                      Display name
                                    </Label>
                                    <Input
                                      id={`${account.id}_displayName`}
                                      name="displayName"
                                      defaultValue={account.displayName ?? ""}
                                      placeholder={account.name}
                                    />
                                  </div>
                                  <div className="space-y-1.5">
                                    <Label
                                      htmlFor={`${account.id}_ownershipType`}
                                      className="text-xs"
                                    >
                                      Ownership
                                    </Label>
                                    <select
                                      id={`${account.id}_ownershipType`}
                                      name="ownershipType"
                                      defaultValue={account.ownershipType}
                                      className="flex h-9 w-full rounded-lg border border-border/60 bg-card/60 px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                                    >
                                      {ownershipTypes.map((o) => (
                                        <option key={o} value={o}>
                                          {o}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-4 rounded-lg border border-border/40 bg-muted/20 p-3">
                                  <label
                                    htmlFor={checkboxNameFor(
                                      account.id,
                                      "reporting",
                                    )}
                                    className="flex items-center gap-2 text-sm"
                                  >
                                    <input
                                      id={checkboxNameFor(
                                        account.id,
                                        "reporting",
                                      )}
                                      name="includeInHouseholdReporting"
                                      type="checkbox"
                                      defaultChecked={
                                        account.includeInHouseholdReporting
                                      }
                                      className="size-4 rounded border-border"
                                    />
                                    Include in reporting
                                  </label>
                                  <label
                                    htmlFor={checkboxNameFor(
                                      account.id,
                                      "hidden",
                                    )}
                                    className="flex items-center gap-2 text-sm"
                                  >
                                    <input
                                      id={checkboxNameFor(account.id, "hidden")}
                                      name="isHidden"
                                      type="checkbox"
                                      defaultChecked={account.isHidden}
                                      className="size-4 rounded border-border"
                                    />
                                    Hide on snapshot
                                  </label>
                                </div>
                                <Button
                                  type="submit"
                                  size="sm"
                                  disabled={isSaving}
                                >
                                  {isSaving ? "Saving..." : "Save"}
                                </Button>
                              </form>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    {normalizedSearch
                      ? "No accounts match this search"
                      : "No accounts available"}
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardShell>
  );
}

export default function AccountReview({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>() as ActionData | undefined;
  const navigation = useNavigation();
  const activeSaveAccountId =
    navigation.state === "submitting"
      ? navigation.formData?.get("accountId")
      : null;

  return (
    <AccountReviewScreen
      activeSaveAccountId={
        typeof activeSaveAccountId === "string" ? activeSaveAccountId : null
      }
      actionData={actionData}
      loaderData={loaderData}
    />
  );
}
