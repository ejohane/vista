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
import { type ReactNode, useState } from "react";
import { redirect, useActionData, useNavigation } from "react-router";

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
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { formatUpdatedAt, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Route } from "./+types/account-review";

const accountTypeLabels = {
  brokerage: "Brokerage",
  checking: "Checking",
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
  if (!query) {
    return accounts;
  }

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
    <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
    </div>
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
    return {
      kind: "empty" as const,
      updatedAccountId,
    };
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
  const normalizedSearch = searchValue.trim().toLowerCase();
  const filteredAccounts =
    loaderData.kind === "ready"
      ? filterAccounts(loaderData.accounts, normalizedSearch)
      : [];
  const groupedAccounts = groupAccounts(filteredAccounts);
  const updatedAccount =
    loaderData.kind === "ready" && loaderData.updatedAccountId
      ? loaderData.accounts.find(
          (account) => account.id === loaderData.updatedAccountId,
        )
      : null;
  const sidebarSections: AppSidebarSection[] =
    loaderData.kind === "ready"
      ? [
          {
            title: "Review",
            items: [
              {
                badge: String(loaderData.summary.includedCount),
                href: "#overview",
                isActive: true,
                title: "Curation overview",
              },
              {
                href: "#accounts",
                title: "Imported accounts",
              },
            ],
          },
          {
            title: normalizedSearch ? "Matches" : "Account types",
            items: groupedAccounts.length
              ? groupedAccounts.map((group) => ({
                  badge: String(group.accounts.length),
                  href: `#group-${group.key}`,
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
            ],
          },
        ];

  return (
    <SidebarProvider defaultOpen>
      <AppSidebar
        helperText={
          loaderData.kind === "ready"
            ? normalizedSearch
              ? `Filtering review cards for "${searchValue}".`
              : "Use this screen for occasional cleanup, not day-to-day workflow."
            : "Connect or seed accounts before reviewing curation."
        }
        onSearchValueChange={setSearchValue}
        searchDisabled={loaderData.kind === "empty"}
        searchPlaceholder={
          loaderData.kind === "ready"
            ? "Search names, institutions, or account types..."
            : "Account data required"
        }
        searchValue={searchValue}
        sections={sidebarSections}
        status={loaderData.kind}
        subtitle={
          loaderData.kind === "ready"
            ? `Snapshot updated ${formatUpdatedAt(loaderData.lastSyncedAt)}`
            : "No imported accounts yet"
        }
        summary={
          loaderData.kind === "ready"
            ? [
                {
                  label: "Included",
                  value: String(loaderData.summary.includedCount),
                },
                {
                  label: "Hidden",
                  value: String(loaderData.summary.hiddenCount),
                },
              ]
            : [
                {
                  label: "Status",
                  value: "Awaiting import",
                },
                {
                  label: "Next step",
                  value: "Connect SimpleFIN",
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
                <a className="text-muted-foreground" href="/">
                  Vista
                </a>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>Account review</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <main className="relative flex flex-1 flex-col overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,_rgba(226,91,36,0.18),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(34,197,94,0.12),_transparent_26%),linear-gradient(180deg,_rgba(255,251,247,1)_0%,_rgba(250,246,241,1)_52%,_rgba(245,239,232,0.96)_100%)]" />
          <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
            {loaderData.kind === "ready" ? (
              <>
                <section
                  id="overview"
                  className="grid scroll-mt-24 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.95fr)]"
                >
                  <Card className="border-border/70 bg-card/95 shadow-sm">
                    <CardHeader className="gap-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="bg-primary text-primary-foreground">
                          Rare maintenance flow
                        </Badge>
                        <Badge
                          variant="outline"
                          className="border-border/80 bg-background/75"
                        >
                          Home stays household-first
                        </Badge>
                      </div>
                      <div className="space-y-3">
                        <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">
                          Account review
                        </p>
                        <CardTitle className="text-4xl tracking-tight sm:text-5xl">
                          Review imported accounts
                        </CardTitle>
                        <CardDescription className="max-w-3xl text-base leading-7 text-muted-foreground">
                          Rename cards for the household snapshot, set
                          ownership, hide noisy accounts from the default
                          breakdown, and exclude accounts that should not affect
                          household reporting.
                        </CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent className="grid gap-4 md:grid-cols-3">
                      <SummaryCard
                        detail="Accounts still counted in household totals."
                        icon={<ShieldCheckIcon className="size-4" />}
                        label="Included"
                        value={String(loaderData.summary.includedCount)}
                      />
                      <SummaryCard
                        detail="Accounts removed from the default breakdown cards."
                        icon={<EyeSlashIcon className="size-4" />}
                        label="Hidden"
                        value={String(loaderData.summary.hiddenCount)}
                      />
                      <SummaryCard
                        detail="Accounts left out of household reporting until re-enabled."
                        icon={<FunnelSimpleXIcon className="size-4" />}
                        label="Excluded"
                        value={String(loaderData.summary.excludedCount)}
                      />
                    </CardContent>
                  </Card>

                  <div className="grid gap-4">
                    {updatedAccount ? (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 shadow-sm">
                        <p className="font-medium">
                          Saved changes for{" "}
                          {updatedAccount.displayName ?? updatedAccount.name}.
                        </p>
                        <p className="mt-2 text-sm leading-6 opacity-80">
                          The home snapshot will now honor the latest curation
                          settings for this account.
                        </p>
                      </div>
                    ) : null}
                    {actionData ? (
                      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-950 shadow-sm">
                        <p className="font-medium">{actionData.message}</p>
                      </div>
                    ) : null}
                    <div className="rounded-2xl border border-border/70 bg-background/80 p-4 shadow-sm">
                      <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                        Snapshot contract
                      </p>
                      <p className="mt-3 text-sm leading-6 text-muted-foreground">
                        Excluding an account changes totals and change summary.
                        Hiding an account only removes it from the default
                        breakdown cards, so the snapshot can stay cleaner
                        without changing the household math.
                      </p>
                    </div>
                    <a
                      href="/"
                      className={cn(
                        buttonVariants({
                          size: "default",
                          variant: "outline",
                        }),
                        "w-fit",
                      )}
                    >
                      Back to snapshot
                    </a>
                  </div>
                </section>

                <section id="accounts" className="scroll-mt-24 space-y-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div>
                      <h2 className="text-2xl font-semibold tracking-tight">
                        Imported accounts
                      </h2>
                      <p className="text-sm leading-6 text-muted-foreground">
                        These forms only write lightweight curation data. Sync
                        history and provider mappings stay untouched.
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
                  {groupedAccounts.length ? (
                    <div className="space-y-6">
                      {groupedAccounts.map((group) => (
                        <div
                          id={`group-${group.key}`}
                          key={group.key}
                          className="scroll-mt-24 space-y-3"
                        >
                          <div>
                            <h3 className="text-xl font-semibold tracking-tight">
                              {group.label}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              {group.accounts.length} imported account
                              {group.accounts.length === 1 ? "" : "s"}
                            </p>
                          </div>
                          <div className="grid gap-4 xl:grid-cols-2">
                            {group.accounts.map((account) => {
                              const effectiveName =
                                account.displayName ?? account.name;
                              const isSaving =
                                activeSaveAccountId === account.id;

                              return (
                                <Card
                                  key={account.id}
                                  className="border-border/70 bg-card/95 shadow-sm"
                                >
                                  <CardHeader className="gap-4">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                      <div className="space-y-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <Badge className="bg-primary/10 text-primary">
                                            {formatUsd(account.balanceMinor)}
                                          </Badge>
                                          {!account.includeInHouseholdReporting ? (
                                            <Badge
                                              variant="outline"
                                              className="border-amber-200 bg-amber-50 text-amber-900"
                                            >
                                              Excluded
                                            </Badge>
                                          ) : null}
                                          {account.isHidden ? (
                                            <Badge
                                              variant="outline"
                                              className="border-slate-300 bg-slate-100 text-slate-700"
                                            >
                                              Hidden on home
                                            </Badge>
                                          ) : null}
                                        </div>
                                        <CardTitle className="text-xl">
                                          {effectiveName}
                                        </CardTitle>
                                        <CardDescription className="leading-6">
                                          {account.institutionName} · imported
                                          as {account.name}
                                        </CardDescription>
                                      </div>
                                      <div className="rounded-2xl border border-border/70 bg-background/75 px-3 py-2 text-right">
                                        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                                          Ownership
                                        </p>
                                        <p className="mt-1 text-sm font-semibold capitalize">
                                          {account.ownershipType}
                                        </p>
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
                                      <div className="space-y-2">
                                        <Label
                                          htmlFor={`${account.id}_displayName`}
                                        >
                                          Display name
                                        </Label>
                                        <Input
                                          id={`${account.id}_displayName`}
                                          name="displayName"
                                          defaultValue={
                                            account.displayName ?? ""
                                          }
                                          placeholder={account.name}
                                        />
                                      </div>
                                      <div className="grid gap-4 md:grid-cols-2">
                                        <div className="space-y-2">
                                          <Label
                                            htmlFor={`${account.id}_ownershipType`}
                                          >
                                            Ownership
                                          </Label>
                                          <select
                                            id={`${account.id}_ownershipType`}
                                            name="ownershipType"
                                            defaultValue={account.ownershipType}
                                            className="flex h-9 w-full min-w-0 rounded-4xl border border-input bg-input/30 px-3 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                          >
                                            {ownershipTypes.map((option) => (
                                              <option
                                                key={option}
                                                value={option}
                                              >
                                                {option}
                                              </option>
                                            ))}
                                          </select>
                                        </div>
                                        <label
                                          htmlFor={checkboxNameFor(
                                            account.id,
                                            "reporting",
                                          )}
                                          className="flex min-h-24 items-start gap-3 rounded-2xl border border-border/70 bg-background/75 p-4"
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
                                            className="mt-1 size-4 rounded border border-input text-primary"
                                          />
                                          <div>
                                            <p className="font-medium">
                                              Exclude from household reporting
                                            </p>
                                            <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                              Uncheck this when the account
                                              should not affect household totals
                                              or change explanations.
                                            </p>
                                          </div>
                                        </label>
                                      </div>
                                      <label
                                        htmlFor={checkboxNameFor(
                                          account.id,
                                          "hidden",
                                        )}
                                        className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/75 p-4"
                                      >
                                        <input
                                          id={checkboxNameFor(
                                            account.id,
                                            "hidden",
                                          )}
                                          name="isHidden"
                                          type="checkbox"
                                          defaultChecked={account.isHidden}
                                          className="mt-1 size-4 rounded border border-input text-primary"
                                        />
                                        <div>
                                          <p className="font-medium">
                                            Hide on the snapshot
                                          </p>
                                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                            Keep the account out of the default
                                            breakdown cards without changing the
                                            household totals.
                                          </p>
                                        </div>
                                      </label>
                                      <div className="flex flex-wrap items-center gap-3">
                                        <Button
                                          type="submit"
                                          disabled={isSaving}
                                        >
                                          {isSaving
                                            ? "Saving..."
                                            : "Save changes"}
                                        </Button>
                                        <p className="text-sm text-muted-foreground">
                                          Account ID: {account.id}
                                        </p>
                                      </div>
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
                    <Card className="border-border/70 bg-card/95 shadow-sm">
                      <CardHeader className="gap-2">
                        <CardTitle className="text-xl">
                          No accounts match this filter
                        </CardTitle>
                        <CardDescription className="leading-6">
                          Broaden the search to review the full imported account
                          list again.
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  )}
                </section>
              </>
            ) : (
              <section
                id="overview"
                className="grid scroll-mt-24 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]"
              >
                <Card className="border-border/70 bg-card/95 shadow-sm">
                  <CardHeader className="gap-4">
                    <div className="space-y-3">
                      <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">
                        Account review
                      </p>
                      <CardTitle className="text-4xl tracking-tight sm:text-5xl">
                        No imported accounts to curate yet
                      </CardTitle>
                      <CardDescription className="max-w-3xl text-base leading-7 text-muted-foreground">
                        Connect a real provider or seed local data first. This
                        screen only handles lightweight curation after Vista has
                        at least one household account to review.
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-3">
                    <a
                      href="/connect/simplefin"
                      className={cn(
                        buttonVariants({
                          size: "default",
                          variant: "outline",
                        }),
                      )}
                    >
                      Connect SimpleFIN
                    </a>
                    <a
                      href="/"
                      className={cn(
                        buttonVariants({
                          size: "default",
                          variant: "ghost",
                        }),
                      )}
                    >
                      Back to snapshot
                    </a>
                  </CardContent>
                </Card>
              </section>
            )}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
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
