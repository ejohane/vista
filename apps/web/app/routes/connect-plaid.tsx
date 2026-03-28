import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  LinkIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { syncPlaidConnection } from "@vista/plaid";
import { useEffect, useRef, useState } from "react";
import {
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  createPlaidLinkToken,
  exchangePlaidPublicToken,
} from "@/lib/plaid-connect";
import { cn } from "@/lib/utils";
import type { Route } from "./+types/connect-plaid";

type ActionData = {
  message: string;
  ok: false;
};

type LoaderData =
  | {
      kind: "error";
      message: string;
      title: string;
    }
  | {
      kind: "ready";
      linkToken: string;
    };

type CreatePlaidLinkTokenFn = typeof createPlaidLinkToken;
type ExchangePlaidPublicTokenFn = typeof exchangePlaidPublicToken;
type SyncPlaidConnectionFn = typeof syncPlaidConnection;

type PlaidLinkHandler = {
  destroy: () => void;
  open: () => void;
};

type PlaidLinkMetadata = {
  institution: null | {
    institution_id: null | string;
    name: null | string;
  };
};

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        onExit?: (
          error: null | { display_message?: string; error_message?: string },
        ) => void;
        onSuccess: (publicToken: string, metadata: PlaidLinkMetadata) => void;
        token: string;
      }) => PlaidLinkHandler;
    };
  }
}

function readOptionalEnvString(
  env: unknown,
  key: "PLAID_CLIENT_ID" | "PLAID_ENV" | "PLAID_SECRET",
) {
  const record = env as Record<string, unknown>;
  const value = record[key];

  return typeof value === "string" && value.trim() ? value : undefined;
}

export function createConnectPlaidAction(deps?: {
  exchangePlaidPublicToken?: ExchangePlaidPublicTokenFn;
  syncPlaidConnection?: SyncPlaidConnectionFn;
}) {
  const exchangeConnection =
    deps?.exchangePlaidPublicToken ?? exchangePlaidPublicToken;
  const syncConnection = deps?.syncPlaidConnection ?? syncPlaidConnection;

  return async function action({
    context,
    request,
  }: {
    context: { cloudflare: { env: Env } };
    request: Request;
  }) {
    const clientId = readOptionalEnvString(
      context.cloudflare.env,
      "PLAID_CLIENT_ID",
    );
    const secret = readOptionalEnvString(
      context.cloudflare.env,
      "PLAID_SECRET",
    );
    const environment = readOptionalEnvString(
      context.cloudflare.env,
      "PLAID_ENV",
    ) as "development" | "production" | "sandbox" | undefined;

    if (!clientId || !secret) {
      return {
        message:
          "Set PLAID_CLIENT_ID and PLAID_SECRET before starting Plaid onboarding.",
        ok: false,
      } satisfies ActionData;
    }

    const formData = await request.formData();
    const publicToken = formData.get("publicToken");
    const institutionId = formData.get("institutionId");
    const institutionName = formData.get("institutionName");

    if (typeof publicToken !== "string" || !publicToken.trim()) {
      return {
        message: "Plaid did not return a valid connection token.",
        ok: false,
      } satisfies ActionData;
    }

    try {
      const result = await exchangeConnection({
        clientId,
        database: context.cloudflare.env.DB,
        environment,
        institutionId:
          typeof institutionId === "string" ? institutionId : undefined,
        institutionName:
          typeof institutionName === "string" ? institutionName : undefined,
        publicToken,
        secret,
      });

      try {
        await syncConnection({
          clientId,
          connectionId: result.connectionId,
          database: context.cloudflare.env.DB,
          environment,
          secret,
        });
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message
            : "Plaid first sync failed unexpectedly.";

        console.error("Plaid first sync failed after connection save.", {
          connectionId: result.connectionId,
          error: reason,
          householdId: result.householdId,
        });

        return {
          message: `Plaid connection was saved, but the first sync failed: ${reason}`,
          ok: false,
        } satisfies ActionData;
      }

      return redirect("/");
    } catch (error) {
      console.error("Plaid onboarding failed.", {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        message:
          error instanceof Error
            ? error.message
            : "Plaid onboarding failed unexpectedly.",
        ok: false,
      } satisfies ActionData;
    }
  };
}

export const action = createConnectPlaidAction();

function buildLoaderErrorData(title: string, message: string) {
  return {
    kind: "error" as const,
    message,
    title,
  };
}

export function createConnectPlaidLoader(deps?: {
  createPlaidLinkToken?: CreatePlaidLinkTokenFn;
}) {
  const createLinkToken = deps?.createPlaidLinkToken ?? createPlaidLinkToken;

  return async function loader({
    context,
  }: {
    context: { cloudflare: { env: Env } };
  }): Promise<LoaderData> {
    const clientId = readOptionalEnvString(
      context.cloudflare.env,
      "PLAID_CLIENT_ID",
    );
    const secret = readOptionalEnvString(
      context.cloudflare.env,
      "PLAID_SECRET",
    );
    const environment = readOptionalEnvString(
      context.cloudflare.env,
      "PLAID_ENV",
    ) as "development" | "production" | "sandbox" | undefined;

    if (!clientId || !secret) {
      return buildLoaderErrorData(
        "Plaid is not configured",
        "Set PLAID_CLIENT_ID and PLAID_SECRET before launching Plaid Link.",
      );
    }

    try {
      const result = await createLinkToken({
        clientId,
        database: context.cloudflare.env.DB,
        environment,
        secret,
      });

      return {
        kind: "ready",
        linkToken: result.linkToken,
      };
    } catch (error) {
      return buildLoaderErrorData(
        "Plaid is unavailable",
        error instanceof Error
          ? error.message
          : "Plaid Link could not be prepared.",
      );
    }
  };
}

export const loader = createConnectPlaidLoader();

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Vista | Connect Plaid" },
    {
      name: "description",
      content:
        "Launch Plaid Link, save the access token server-side, and import the first account snapshot.",
    },
  ];
}

export default function ConnectPlaid() {
  const loaderData = useLoaderData() as LoaderData;
  const actionData = useActionData<typeof action>() as ActionData | undefined;
  const navigation = useNavigation();
  const submit = useSubmit();
  const [linkState, setLinkState] = useState<
    "failed" | "idle" | "loading" | "ready"
  >(loaderData.kind === "ready" ? "loading" : "idle");
  const [linkError, setLinkError] = useState<null | string>(null);
  const handlerRef = useRef<null | PlaidLinkHandler>(null);
  const hasAutoOpenedRef = useRef(false);
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (loaderData.kind !== "ready") {
      return;
    }

    if (window.Plaid) {
      setLinkState("ready");
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-plaid-link="true"]',
    );
    const script = existingScript ?? document.createElement("script");

    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.dataset.plaidLink = "true";

    function handleLoad() {
      setLinkState("ready");
    }

    function handleError() {
      setLinkState("failed");
      setLinkError(
        "Plaid Link could not be loaded. Refresh the page and try again.",
      );
    }

    script.addEventListener("load", handleLoad);
    script.addEventListener("error", handleError);

    if (!existingScript) {
      document.body.appendChild(script);
    }

    return () => {
      script.removeEventListener("load", handleLoad);
      script.removeEventListener("error", handleError);
    };
  }, [loaderData]);

  useEffect(() => {
    if (
      loaderData.kind !== "ready" ||
      linkState !== "ready" ||
      handlerRef.current ||
      !window.Plaid
    ) {
      return;
    }

    handlerRef.current = window.Plaid.create({
      onExit(error) {
        if (error?.display_message || error?.error_message) {
          setLinkError(error.display_message ?? error.error_message ?? null);
        }
      },
      onSuccess(publicToken, metadata) {
        setLinkError(null);
        const formData = new FormData();
        formData.set("publicToken", publicToken);

        const institutionId = metadata.institution?.institution_id?.trim();
        const institutionName = metadata.institution?.name?.trim();

        if (institutionId) {
          formData.set("institutionId", institutionId);
        }

        if (institutionName) {
          formData.set("institutionName", institutionName);
        }

        submit(formData, { method: "post" });
      },
      token: loaderData.linkToken,
    });

    return () => {
      handlerRef.current?.destroy();
      handlerRef.current = null;
    };
  }, [loaderData, linkState, submit]);

  useEffect(() => {
    if (
      loaderData.kind !== "ready" ||
      linkState !== "ready" ||
      !handlerRef.current ||
      hasAutoOpenedRef.current
    ) {
      return;
    }

    hasAutoOpenedRef.current = true;
    handlerRef.current.open();
  }, [loaderData, linkState]);

  function openPlaidLink() {
    setLinkError(null);
    handlerRef.current?.open();
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10 md:px-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <Card className="border-border/70 bg-card/95 shadow-sm">
          <CardHeader className="gap-4">
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">
                Plaid connection
              </p>
              <CardTitle className="text-4xl tracking-tight sm:text-5xl">
                Connect Plaid without handling tokens yourself
              </CardTitle>
              <CardDescription className="max-w-3xl text-base leading-7 text-muted-foreground">
                Vista now prepares Plaid Link server-side, opens the secure
                Plaid modal in the browser, stores the access token internally,
                and immediately imports the first account snapshot after a
                successful connection.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
            <div className="space-y-4">
              {loaderData.kind === "ready" ? (
                <div className="rounded-3xl border border-border/70 bg-background/75 p-5">
                  <div className="flex items-start gap-3">
                    <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <LinkIcon className="size-5" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium">Secure Plaid Link flow</p>
                      <p className="text-sm leading-6 text-muted-foreground">
                        The institution picker and credential entry happen in
                        Plaid&apos;s modal. Vista never asks the user to paste
                        internal Plaid tokens.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-rose-950">
                  <div className="flex items-start gap-3">
                    <WarningCircleIcon className="mt-0.5 size-5 shrink-0" />
                    <div>
                      <p className="font-medium">{loaderData.title}</p>
                      <p className="mt-1 text-sm leading-6">
                        {loaderData.message}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  disabled={
                    loaderData.kind !== "ready" ||
                    isSubmitting ||
                    linkState === "failed" ||
                    linkState === "loading"
                  }
                  onClick={openPlaidLink}
                >
                  {isSubmitting
                    ? "Finishing Plaid..."
                    : linkState === "loading"
                      ? "Preparing Plaid..."
                      : "Continue with Plaid"}
                </Button>
                <a
                  href="https://plaid.com/docs/link/"
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    buttonVariants({ size: "default", variant: "outline" }),
                  )}
                >
                  Plaid docs
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
              {actionData || linkError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-950">
                  <p className="font-medium">
                    {actionData?.message ?? linkError}
                  </p>
                </div>
              ) : null}
            </div>

            <div className="grid gap-4">
              <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                  What Vista stores
                </p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Vista stores the Plaid access token, item id, and institution
                  metadata on the `plaid` provider-connection row.
                </p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                  What happens next
                </p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  A successful Plaid Link session is exchanged server-side and
                  immediately runs the first sync. This slice still only imports
                  Plaid accounts and balances; holdings, transactions, and
                  richer liability detail are next.
                </p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
                <div className="flex items-center gap-2 text-foreground">
                  <CheckCircleIcon className="size-4" />
                  <p className="font-medium">No manual token handling</p>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  The user-facing page no longer exposes Plaid public tokens or
                  institution ids. Those details stay inside the Plaid modal and
                  the server-side exchange flow.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
