import { describe, expect, mock, test } from "bun:test";

import { createRequireViewerContext } from "./auth.server";

describe("createRequireViewerContext", () => {
  test("redirects anonymous requests to sign-in with a return url", async () => {
    const requireViewerContext = createRequireViewerContext({
      ensureClerkIdentityMembership: mock(async () => {
        throw new Error("ensureClerkIdentityMembership should not be called");
      }),
      getAuth: mock(async () => ({ userId: null })),
    });

    try {
      await requireViewerContext({
        context: {
          cloudflare: {
            env: {
              DB: {} as D1Database,
            },
          },
        },
        request: new Request("https://vista.example/portfolio?range=30d"),
      } as never);
      throw new Error("Expected unauthenticated request to redirect.");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(302);
      expect((error as Response).headers.get("Location")).toBe(
        "/sign-in?redirect_url=%2Fportfolio%3Frange%3D30d",
      );
    }
  });

  test("bootstraps and returns the authenticated viewer membership", async () => {
    const ensureClerkIdentityMembershipMock = mock(async () => ({
      created: true,
      householdId: "household_viewer",
      householdName: "My Household",
      memberId: "member_viewer",
      memberRole: "owner" as const,
    }));
    const requireViewerContext = createRequireViewerContext({
      ensureClerkIdentityMembership: ensureClerkIdentityMembershipMock,
      getAuth: mock(async () => ({ userId: "user_123" })),
    });

    const result = await requireViewerContext({
      context: {
        cloudflare: {
          env: {
            DB: {} as D1Database,
          },
        },
      },
      request: new Request("https://vista.example/"),
    } as never);

    expect(result).toEqual({
      clerkUserId: "user_123",
      householdId: "household_viewer",
      householdName: "My Household",
      memberId: "member_viewer",
      memberRole: "owner",
    });
    expect(ensureClerkIdentityMembershipMock).toHaveBeenCalledWith({
      clerkUserId: "user_123",
      database: {} as D1Database,
    });
  });
});
