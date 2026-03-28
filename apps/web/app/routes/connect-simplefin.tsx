import { ArrowSquareOutIcon, LinkBreakIcon } from "@phosphor-icons/react";
import { syncSimplefinConnection } from "@vista/simplefin";
import { Form, redirect, useActionData, useNavigation } from "react-router";

import { DashboardShell } from "@/components/dashboard-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { claimSimplefinSetupToken } from "@/lib/simplefin-claim";
import { cn } from "@/lib/utils";
import type { Route } from "./+types/connect-simplefin";

type ActionData = {
  message: string;
  ok: false;
};

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Vista | Connect SimpleFIN" },
    {
      name: "description",
      content:
        "Claim a SimpleFIN setup token, save the access URL, and import your first snapshot.",
    },
  ];
}

export async function action({ context, request }: Route.ActionArgs) {
  const formData = await request.formData();
  const setupToken = formData.get("setupToken");

  if (typeof setupToken !== "string" || !setupToken.trim()) {
    return {
      message: "Paste a SimpleFIN setup token before submitting.",
      ok: false,
    } satisfies ActionData;
  }

  try {
    const result = await claimSimplefinSetupToken({
      database: context.cloudflare.env.DB,
      setupToken,
    });

    try {
      await syncSimplefinConnection({
        connectionId: result.connectionId,
        database: context.cloudflare.env.DB,
      });
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "SimpleFIN first sync failed unexpectedly.";

      return {
        message: `SimpleFIN connection was saved, but the first sync failed: ${reason}`,
        ok: false,
      } satisfies ActionData;
    }

    return redirect("/");
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "SimpleFIN claim failed unexpectedly.",
      ok: false,
    } satisfies ActionData;
  }
}

export default function ConnectSimplefin() {
  const actionData = useActionData<typeof action>() as ActionData | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <DashboardShell activePath="/connect/simplefin">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-5 lg:p-8">
        <Card className="border-border/70 bg-card/95 shadow-sm">
          <CardHeader className="gap-4">
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">
                SimpleFIN connection
              </p>
              <CardTitle className="text-4xl tracking-tight sm:text-5xl">
                Connect your bank without touching D1
              </CardTitle>
              <CardDescription className="max-w-3xl text-base leading-7 text-muted-foreground">
                Generate a setup token from SimpleFIN Bridge, paste it here, and
                Vista will claim the access URL, run the first sync immediately,
                and drop you back on the live snapshot.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
            <Form method="post" className="space-y-4">
              <div className="space-y-2">
                <label
                  htmlFor="setupToken"
                  className="text-sm font-medium text-foreground"
                >
                  Setup token
                </label>
                <textarea
                  id="setupToken"
                  name="setupToken"
                  rows={8}
                  placeholder="Paste the SimpleFIN setup token here"
                  className="min-h-40 w-full rounded-3xl border border-input bg-input/30 px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Connecting..." : "Connect and sync"}
                </Button>
                <a
                  href="https://bridge.simplefin.org/simplefin/create"
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    buttonVariants({ size: "default", variant: "outline" }),
                  )}
                >
                  Get a token
                  <ArrowSquareOutIcon className="size-4" />
                </a>
                <a
                  href="/"
                  className={cn(
                    buttonVariants({ size: "default", variant: "ghost" }),
                  )}
                >
                  Back to snapshot
                </a>
              </div>
              {actionData ? (
                <div
                  className={cn(
                    "rounded-2xl border p-4 text-sm leading-6",
                    actionData.ok
                      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                      : "border-rose-200 bg-rose-50 text-rose-950",
                  )}
                >
                  <p className="font-medium">{actionData.message}</p>
                </div>
              ) : null}
            </Form>

            <div className="grid gap-4">
              <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                  What Vista stores
                </p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  The claimed access URL is stored on the `simplefin`
                  provider-connection row. Vista then uses it immediately to
                  poll `/accounts` for the first import.
                </p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                  What happens next
                </p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  A successful claim runs the same SimpleFIN sync code the
                  scheduled worker uses. If the import succeeds, you land back
                  on the snapshot with real balances already loaded.
                </p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
                <div className="flex items-center gap-2 text-foreground">
                  <LinkBreakIcon className="size-4" />
                  <p className="font-medium">One-time claim flow</p>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  SimpleFIN setup tokens are one-time credentials. If a claim
                  fails with 403, generate a fresh token and try again.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
