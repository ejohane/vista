import { getAuth } from "@clerk/react-router/server";
import { ensureClerkIdentityMembership, type MemberRole } from "@vista/db";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  RouterContextProvider,
} from "react-router";
import { redirect } from "react-router";

import { readCloudflareEnv } from "./server-context";

type AuthResult = {
  userId: null | string;
};

type ViewerArgs = {
  context:
    | Readonly<RouterContextProvider>
    | {
        cloudflare: {
          env: Env;
        };
      };
  request: Request;
  params?: LoaderFunctionArgs["params"];
  unstable_pattern?: ActionFunctionArgs["unstable_pattern"];
};

export type ViewerContext = {
  clerkUserId: string;
  householdId: string;
  householdName: string;
  memberId: string;
  memberRole: MemberRole;
};

function buildRedirectParam(requestUrl: string) {
  const url = new URL(requestUrl);
  return `${url.pathname}${url.search}`;
}

export function buildSignInRedirectUrl(requestUrl: string) {
  return `/sign-in?redirect_url=${encodeURIComponent(buildRedirectParam(requestUrl))}`;
}

export function normalizeAppRedirectUrl(value: null | string | undefined) {
  if (!value?.trim()) {
    return "/";
  }

  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}

export function createRequireViewerContext(deps?: {
  ensureClerkIdentityMembership?: typeof ensureClerkIdentityMembership;
  getAuth?: (args: ViewerArgs) => Promise<AuthResult>;
}) {
  const readAuth = deps?.getAuth ?? getAuth;
  const ensureMembership =
    deps?.ensureClerkIdentityMembership ?? ensureClerkIdentityMembership;

  return async function requireViewerContext(
    args: ViewerArgs,
  ): Promise<ViewerContext> {
    const auth = await readAuth(args as Parameters<typeof getAuth>[0]);
    const userId = "userId" in auth ? auth.userId : null;

    if (!userId) {
      throw redirect(buildSignInRedirectUrl(args.request.url));
    }

    const membership = await ensureMembership({
      clerkUserId: userId,
      database: readCloudflareEnv(args.context).DB,
    });

    return {
      clerkUserId: userId,
      householdId: membership.householdId,
      householdName: membership.householdName,
      memberId: membership.memberId,
      memberRole: membership.memberRole,
    };
  };
}

export const requireViewerContext = createRequireViewerContext();
