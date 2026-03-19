import { ArrowSquareOutIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { createSnaptradePortalClient } from "@vista/snaptrade";
import { Form, redirect, useActionData, useNavigation } from "react-router";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { beginSnaptradeConnection } from "@/lib/snaptrade-connect";
import { cn } from "@/lib/utils";

type ActionData = {
  message: string;
  ok: false;
};

type BeginSnaptradeConnectionFn = typeof beginSnaptradeConnection;

function readOptionalEnvString(
  env: unknown,
  key: "SNAPTRADE_CLIENT_ID" | "SNAPTRADE_CONSUMER_KEY",
) {
  const record = env as Record<string, unknown>;
  const value = record[key];

  return typeof value === "string" && value.trim() ? value : undefined;
}

export function createConnectSnaptradeAction(deps?: {
  beginSnaptradeConnection?: BeginSnaptradeConnectionFn;
}) {
  const beginConnection =
    deps?.beginSnaptradeConnection ?? beginSnaptradeConnection;

  return async function action({
    context,
    request,
  }: {
    context: { cloudflare: { env: Env } };
    request: Request;
  }) {
    const clientId = readOptionalEnvString(
      context.cloudflare.env,
      "SNAPTRADE_CLIENT_ID",
    );
    const consumerKey = readOptionalEnvString(
      context.cloudflare.env,
      "SNAPTRADE_CONSUMER_KEY",
    );

    if (!clientId || !consumerKey) {
      return {
        message:
          "Set SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY before starting SnapTrade onboarding.",
        ok: false,
      } satisfies ActionData;
    }

    try {
      const redirectUrl = new URL(
        "/connect/snaptrade/callback",
        request.url,
      ).toString();
      const result = await beginConnection({
        clientFactory: createSnaptradePortalClient,
        clientId,
        consumerKey,
        database: context.cloudflare.env.DB,
        redirectUrl,
      });

      return redirect(result.redirectUri);
    } catch (error) {
      return {
        message:
          error instanceof Error
            ? error.message
            : "SnapTrade onboarding failed unexpectedly.",
        ok: false,
      } satisfies ActionData;
    }
  };
}

export const action = createConnectSnaptradeAction();

export default function ConnectSnaptrade() {
  const actionData = useActionData<typeof action>() as ActionData | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <main className="min-h-screen bg-background px-4 py-10 md:px-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <Card className="border-border/70 bg-card/95 shadow-sm">
          <CardHeader className="gap-4">
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">
                SnapTrade connection
              </p>
              <CardTitle className="text-4xl tracking-tight sm:text-5xl">
                Launch the brokerage portal and come back with a live connection
              </CardTitle>
              <CardDescription className="max-w-3xl text-base leading-7 text-muted-foreground">
                Vista will register or reuse the household&apos;s SnapTrade
                identity, open the Connection Portal in a direct redirect flow,
                and import the first holdings snapshot as soon as you land back
                in the app.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
            <Form method="post" className="space-y-4">
              <div className="rounded-3xl border border-border/70 bg-background/75 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <ShieldCheckIcon className="size-5" />
                  </div>
                  <div>
                    <p className="font-medium">
                      One redirect, no manual D1 edit
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      SnapTrade handles the brokerage chooser, credentials, MFA,
                      and redirect back into Vista.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting
                    ? "Opening SnapTrade..."
                    : "Open Connection Portal"}
                </Button>
                <a
                  href="/portfolio"
                  className={cn(
                    buttonVariants({ size: "default", variant: "outline" }),
                  )}
                >
                  Back to portfolio
                </a>
                <a
                  href="/connect/simplefin"
                  className={cn(
                    buttonVariants({ size: "default", variant: "ghost" }),
                  )}
                >
                  Connect banking first
                </a>
              </div>
              {actionData ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-950">
                  <p className="font-medium">{actionData.message}</p>
                </div>
              ) : null}
            </Form>

            <div className="grid gap-4">
              <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                  Redirect contract
                </p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  The portal uses SnapTrade&apos;s direct redirect mode, so a
                  successful connect returns to Vista with the `connection_id`
                  in the callback URL.
                </p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                  What Vista stores
                </p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Vista keeps the SnapTrade `userSecret` on the provider row,
                  then upgrades the pending draft into a real brokerage
                  connection after the callback succeeds.
                </p>
              </div>
              <a
                href="https://docs.snaptrade.com/docs/implement-connection-portal"
                target="_blank"
                rel="noreferrer"
                className={cn(
                  buttonVariants({ size: "default", variant: "outline" }),
                  "w-fit",
                )}
              >
                SnapTrade docs
                <ArrowSquareOutIcon className="size-4" />
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
