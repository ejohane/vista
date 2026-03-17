import { getDashboardSnapshot, getDb } from "@vista/db";
import { Landmark, RefreshCw, Server, WalletCards } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatCompactUsd, formatUpdatedAt, formatUsd } from "@/lib/format";
import type { Route } from "./+types/home";

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
  if (loaderData.kind === "empty") {
    return (
      <main className="relative overflow-hidden">
        <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_top_left,_rgba(220,236,229,0.95),_transparent_38%),radial-gradient(circle_at_top_right,_rgba(249,224,201,0.9),_transparent_34%),linear-gradient(180deg,_#fcfaf5_0%,_#f7f3ea_55%,_#f3eee3_100%)]" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(rgba(43,57,51,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(43,57,51,0.05)_1px,transparent_1px)] bg-[size:28px_28px] opacity-35 [mask-image:linear-gradient(to_bottom,white,transparent_88%)]" />

        <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
          <section className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <Card className="rounded-[2rem] border-border/60 bg-card/90 shadow-[0_24px_80px_rgba(20,32,43,0.12)] backdrop-blur">
              <CardHeader className="gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge
                    variant="outline"
                    className="border-emerald-800/15 bg-emerald-900/5 text-emerald-950"
                  >
                    Backend connected
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="bg-stone-900 text-stone-50"
                  >
                    Awaiting snapshot data
                  </Badge>
                </div>
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.32em] text-muted-foreground">
                    First working slice
                  </p>
                  <h1 className="max-w-3xl font-display text-5xl leading-none text-balance text-stone-950 sm:text-6xl">
                    Household snapshot not ready yet
                  </h1>
                  <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                    The app is talking to Cloudflare, but D1 does not have a
                    household snapshot to render yet. Seed the local database or
                    run the sync path before using the dashboard.
                  </p>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="rounded-[1.5rem] border border-border/70 bg-background/75 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                    Local setup
                  </p>
                  <p className="mt-6 text-3xl font-semibold tracking-tight text-stone-950">
                    Seed D1
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Run <code>{loaderData.nextStepCommand}</code> to load sample
                    household data into the local database.
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-border/70 bg-background/75 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                    Expected outcome
                  </p>
                  <p className="mt-6 text-3xl font-semibold tracking-tight text-stone-950">
                    First household snapshot
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Once a household row exists, this page will render totals,
                    grouped accounts, and the latest sync timestamp directly
                    from D1.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[2rem] border-border/60 bg-stone-950 text-stone-50 shadow-[0_24px_80px_rgba(20,32,43,0.18)]">
              <CardHeader>
                <CardTitle className="font-display text-3xl">
                  Infra pulse
                </CardTitle>
                <CardDescription className="text-stone-300">
                  The app runtime is healthy; it just needs data to render.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-start gap-3">
                  <Server
                    aria-hidden="true"
                    className="mt-0.5 size-4 text-emerald-300"
                  />
                  <div>
                    <p className="font-medium">Cloudflare Worker runtime</p>
                    <p className="text-sm text-stone-300">
                      React Router server rendering is reaching the worker
                      entrypoint successfully.
                    </p>
                  </div>
                </div>
                <Separator className="bg-white/10" />
                <div className="flex items-start gap-3">
                  <Landmark
                    aria-hidden="true"
                    className="mt-0.5 size-4 text-amber-300"
                  />
                  <div>
                    <p className="font-medium">D1 database wiring</p>
                    <p className="text-sm text-stone-300">
                      The loader can reach the shared DB package, but there is
                      no household snapshot in D1 yet.
                    </p>
                  </div>
                </div>
                <Separator className="bg-white/10" />
                <div className="flex items-start gap-3">
                  <RefreshCw
                    aria-hidden="true"
                    className="mt-0.5 size-4 text-sky-300"
                  />
                  <div>
                    <p className="font-medium">Next step</p>
                    <p className="text-sm text-stone-300">
                      Seed the local DB or run sync, then refresh the page to
                      confirm the full read path.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        </div>
      </main>
    );
  }

  const metrics = [
    {
      eyebrow: "Everything in scope",
      label: "Net worth",
      value: formatCompactUsd(loaderData.totals.netWorthMinor),
    },
    {
      eyebrow: "Checking + savings",
      label: "Cash",
      value: formatCompactUsd(loaderData.totals.cashMinor),
    },
    {
      eyebrow: "Brokerage + retirement",
      label: "Investments",
      value: formatCompactUsd(loaderData.totals.investmentsMinor),
    },
  ];

  return (
    <main className="relative overflow-hidden">
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_top_left,_rgba(220,236,229,0.95),_transparent_38%),radial-gradient(circle_at_top_right,_rgba(249,224,201,0.9),_transparent_34%),linear-gradient(180deg,_#fcfaf5_0%,_#f7f3ea_55%,_#f3eee3_100%)]" />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(rgba(43,57,51,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(43,57,51,0.05)_1px,transparent_1px)] bg-[size:28px_28px] opacity-35 [mask-image:linear-gradient(to_bottom,white,transparent_88%)]" />

      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <Card className="rounded-[2rem] border-border/60 bg-card/90 shadow-[0_24px_80px_rgba(20,32,43,0.12)] backdrop-blur">
            <CardHeader className="gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge
                  variant="outline"
                  className="border-emerald-800/15 bg-emerald-900/5 text-emerald-950"
                >
                  Backend connected
                </Badge>
                <Badge
                  variant="secondary"
                  className="bg-stone-900 text-stone-50"
                >
                  D1 data loaded
                </Badge>
              </div>
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.32em] text-muted-foreground">
                  First working slice
                </p>
                <h1 className="max-w-3xl font-display text-5xl leading-none text-balance text-stone-950 sm:text-6xl">
                  {loaderData.householdName}
                </h1>
                <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                  The repo is wired end to end: a React Router loader reads a
                  Cloudflare D1 database through the shared workspace package
                  and renders the result with shadcn components.
                </p>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              {metrics.map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-[1.5rem] border border-border/70 bg-background/75 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                    {metric.eyebrow}
                  </p>
                  <p className="mt-6 text-3xl font-semibold tracking-tight text-stone-950">
                    {metric.value}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {metric.label}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-border/60 bg-stone-950 text-stone-50 shadow-[0_24px_80px_rgba(20,32,43,0.18)]">
            <CardHeader>
              <CardTitle className="font-display text-3xl">
                Infra pulse
              </CardTitle>
              <CardDescription className="text-stone-300">
                Enough plumbing to prove the app can read real backend data.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-start gap-3">
                <Server
                  aria-hidden="true"
                  className="mt-0.5 size-4 text-emerald-300"
                />
                <div>
                  <p className="font-medium">Cloudflare Worker runtime</p>
                  <p className="text-sm text-stone-300">
                    React Router server rendering runs through the worker
                    entrypoint.
                  </p>
                </div>
              </div>
              <Separator className="bg-white/10" />
              <div className="flex items-start gap-3">
                <Landmark
                  aria-hidden="true"
                  className="mt-0.5 size-4 text-amber-300"
                />
                <div>
                  <p className="font-medium">
                    D1 as the first system of record
                  </p>
                  <p className="text-sm text-stone-300">
                    Snapshot data in D1 drives the page through the shared query
                    layer.
                  </p>
                </div>
              </div>
              <Separator className="bg-white/10" />
              <div className="flex items-start gap-3">
                <RefreshCw
                  aria-hidden="true"
                  className="mt-0.5 size-4 text-sky-300"
                />
                <div>
                  <p className="font-medium">Shared schema package</p>
                  <p className="text-sm text-stone-300">
                    Both the web app and sync worker point at the same DB
                    package.
                  </p>
                </div>
              </div>
              <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">
                  Last synced (UTC)
                </p>
                <time
                  className="mt-3 block text-lg font-medium"
                  dateTime={loaderData.lastSyncedAt}
                >
                  {formatUpdatedAt(loaderData.lastSyncedAt)}
                </time>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          {loaderData.accountTypeGroups.map((group) => (
            <Card
              key={group.key}
              className="rounded-[1.75rem] border-border/60 bg-card/90 shadow-[0_18px_60px_rgba(20,32,43,0.08)] backdrop-blur"
            >
              <CardHeader className="gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-xl text-stone-950">
                      {group.label}
                    </CardTitle>
                    <CardDescription>
                      {group.accounts.length} account
                      {group.accounts.length === 1 ? "" : "s"}
                    </CardDescription>
                  </div>
                  <Badge
                    variant="outline"
                    className="border-stone-900/10 bg-stone-900/5 text-stone-950"
                  >
                    {formatUsd(group.totalMinor)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-4">
                  {group.accounts.map((account, index) => (
                    <li
                      key={account.id}
                      className={index === 0 ? undefined : "border-t pt-4"}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-medium text-stone-950">
                            {account.name}
                          </p>
                          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                            <WalletCards
                              aria-hidden="true"
                              className="size-3.5"
                            />
                            {account.institutionName}
                          </p>
                        </div>
                        <p className="shrink-0 text-sm font-medium text-stone-950">
                          {formatUsd(account.balanceMinor)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </section>
      </div>
    </main>
  );
}
