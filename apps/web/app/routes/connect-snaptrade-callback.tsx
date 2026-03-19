import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import {
  createSnaptradeDataClient,
  createSnaptradePortalClient,
  syncSnaptradeConnection,
} from "@vista/snaptrade";
import { redirect, useLoaderData } from "react-router";

import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { completeSnaptradeConnection } from "@/lib/snaptrade-connect";
import { cn } from "@/lib/utils";

type LoaderData = {
  message: string;
  ok: false;
  title: string;
};

type CompleteSnaptradeConnectionFn = typeof completeSnaptradeConnection;
type SyncSnaptradeConnectionFn = typeof syncSnaptradeConnection;

function readOptionalEnvString(
  env: unknown,
  key: "SNAPTRADE_CLIENT_ID" | "SNAPTRADE_CONSUMER_KEY",
) {
  const record = env as Record<string, unknown>;
  const value = record[key];

  return typeof value === "string" && value.trim() ? value : undefined;
}

function buildErrorData(title: string, message: string) {
  return {
    message,
    ok: false as const,
    title,
  };
}

export function createConnectSnaptradeCallbackLoader(deps?: {
  completeSnaptradeConnection?: CompleteSnaptradeConnectionFn;
  syncSnaptradeConnection?: SyncSnaptradeConnectionFn;
}) {
  const completeConnection =
    deps?.completeSnaptradeConnection ?? completeSnaptradeConnection;
  const syncConnection =
    deps?.syncSnaptradeConnection ?? syncSnaptradeConnection;

  return async function loader({
    context,
    request,
  }: {
    context: { cloudflare: { env: Env } };
    request: Request;
  }) {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const draftConnectionId = url.searchParams.get("draftConnectionId");

    if (!draftConnectionId) {
      return buildErrorData(
        "SnapTrade callback is incomplete",
        "SnapTrade did not return the draft connection reference needed to save the callback.",
      );
    }

    if (status === "ERROR") {
      const errorCode = url.searchParams.get("error_code") ?? "UNKNOWN_ERROR";
      const statusCode = url.searchParams.get("status_code") ?? "unknown";

      return buildErrorData(
        "SnapTrade connection failed",
        `SnapTrade returned ERROR (${errorCode} / ${statusCode}).`,
      );
    }

    if (status === "ABANDONED") {
      return buildErrorData(
        "SnapTrade connection was abandoned",
        "The portal was closed before a brokerage connection finished.",
      );
    }

    if (status !== "SUCCESS") {
      return buildErrorData(
        "SnapTrade callback is incomplete",
        "SnapTrade did not return a successful connection result.",
      );
    }

    const callbackConnectionId = url.searchParams.get("connection_id");

    if (!callbackConnectionId) {
      return buildErrorData(
        "SnapTrade callback is incomplete",
        "SnapTrade reported success without a connection_id.",
      );
    }

    const clientId = readOptionalEnvString(
      context.cloudflare.env,
      "SNAPTRADE_CLIENT_ID",
    );
    const consumerKey = readOptionalEnvString(
      context.cloudflare.env,
      "SNAPTRADE_CONSUMER_KEY",
    );

    if (!clientId || !consumerKey) {
      return buildErrorData(
        "SnapTrade callback cannot be processed",
        "Set SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY before processing SnapTrade callbacks.",
      );
    }

    try {
      const completedConnection = await completeConnection({
        callbackConnectionId,
        clientFactory: createSnaptradePortalClient,
        clientId,
        connectionDraftId: draftConnectionId,
        consumerKey,
        database: context.cloudflare.env.DB,
      });

      if (completedConnection.status !== "active") {
        return buildErrorData(
          "SnapTrade connection needs attention",
          "SnapTrade saved the connection, but it is currently disconnected and cannot sync yet.",
        );
      }

      try {
        await syncConnection({
          clientFactory: createSnaptradeDataClient,
          clientId,
          connectionId: completedConnection.connectionId,
          consumerKey,
          database: context.cloudflare.env.DB,
        });
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message
            : "SnapTrade first sync failed unexpectedly.";

        return buildErrorData(
          "SnapTrade connected but sync failed",
          `SnapTrade connection was saved, but the first sync failed: ${reason}`,
        );
      }

      return redirect("/portfolio");
    } catch (error) {
      return buildErrorData(
        "SnapTrade callback could not be saved",
        error instanceof Error
          ? error.message
          : "SnapTrade callback handling failed unexpectedly.",
      );
    }
  };
}

export const loader = createConnectSnaptradeCallbackLoader();

export default function ConnectSnaptradeCallback() {
  const loaderData = useLoaderData() as LoaderData;

  return (
    <main className="min-h-screen bg-background px-4 py-10 md:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <Card className="border-border/70 bg-card/95 shadow-sm">
          <CardHeader className="gap-4">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-900">
              <WarningCircleIcon className="size-6" />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">
                SnapTrade callback
              </p>
              <CardTitle className="text-3xl tracking-tight">
                {loaderData.title}
              </CardTitle>
              <CardDescription className="text-base leading-7 text-muted-foreground">
                {loaderData.message}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <a
              href="/connect/snaptrade"
              className={cn(
                buttonVariants({ size: "default", variant: "outline" }),
              )}
            >
              Try SnapTrade again
            </a>
            <a
              href="/portfolio"
              className={cn(
                buttonVariants({ size: "default", variant: "ghost" }),
              )}
            >
              Back to portfolio
            </a>
          </CardContent>
        </Card>
        <div className="rounded-2xl border border-border/70 bg-background/75 p-4 text-sm leading-6 text-muted-foreground">
          <div className="flex items-center gap-2 text-foreground">
            <CheckCircleIcon className="size-4" />
            <p className="font-medium">What Vista expected</p>
          </div>
          <p className="mt-3">
            A successful SnapTrade redirect should include `status=SUCCESS`, the
            `connection_id`, and the draft reference Vista attached to the
            callback URL when it launched the portal.
          </p>
        </div>
      </div>
    </main>
  );
}
