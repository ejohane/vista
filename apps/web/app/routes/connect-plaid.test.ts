import { describe, expect, mock, test } from "bun:test";

import {
  createConnectPlaidAction,
  createConnectPlaidLoader,
} from "./connect-plaid";

describe("connect plaid route loader", () => {
  test("creates a link token when Plaid is configured", async () => {
    const createLinkTokenMock = mock(async () => {
      return {
        householdId: "household_viewer",
        householdWasCreated: false,
        linkToken: "link-sandbox-101",
      };
    });
    const requireViewerContextMock = mock(async () => ({
      clerkUserId: "user_123",
      householdId: "household_viewer",
      householdName: "My Household",
      memberId: "member_viewer",
      memberRole: "owner" as const,
    }));
    const loader = createConnectPlaidLoader({
      createPlaidLinkToken: createLinkTokenMock,
      requireViewerContext: requireViewerContextMock,
    });

    const result = await loader({
      context: {
        cloudflare: {
          env: {
            DB: {} as D1Database,
            PLAID_CLIENT_ID: "client-demo",
            PLAID_ENV: "sandbox",
            PLAID_SECRET: "secret-demo",
          },
        },
      },
      request: new Request("http://localhost/connect/plaid"),
    } as never);

    expect(result).toEqual({
      kind: "ready",
      linkToken: "link-sandbox-101",
    });
    expect(createLinkTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-demo",
        database: {} as D1Database,
        environment: "sandbox",
        householdId: "household_viewer",
        secret: "secret-demo",
      }),
    );
  });

  test("passes a redirect url for https Plaid OAuth flows", async () => {
    const createLinkTokenMock = mock(async () => {
      return {
        householdId: "household_viewer",
        householdWasCreated: false,
        linkToken: "link-sandbox-102",
      };
    });
    const requireViewerContextMock = mock(async () => ({
      clerkUserId: "user_123",
      householdId: "household_viewer",
      householdName: "My Household",
      memberId: "member_viewer",
      memberRole: "owner" as const,
    }));
    const loader = createConnectPlaidLoader({
      createPlaidLinkToken: createLinkTokenMock,
      requireViewerContext: requireViewerContextMock,
    });

    const result = await loader({
      context: {
        cloudflare: {
          env: {
            DB: {} as D1Database,
            PLAID_CLIENT_ID: "client-demo",
            PLAID_ENV: "production",
            PLAID_SECRET: "secret-demo",
          },
        },
      },
      request: new Request(
        "https://vista.example/connect/plaid?oauth_state_id=demo",
      ),
    } as never);

    expect(result).toEqual({
      kind: "ready",
      linkToken: "link-sandbox-102",
    });
    expect(createLinkTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUrl: "https://vista.example/connect/plaid",
      }),
    );
  });

  test("returns a config error when Plaid credentials are missing", async () => {
    const loader = createConnectPlaidLoader({
      createPlaidLinkToken: mock(async () => {
        throw new Error("createPlaidLinkToken should not be called");
      }),
      requireViewerContext: mock(async () => ({
        clerkUserId: "user_123",
        householdId: "household_viewer",
        householdName: "My Household",
        memberId: "member_viewer",
        memberRole: "owner" as const,
      })),
    });

    const result = await loader({
      context: {
        cloudflare: {
          env: {
            DB: {} as D1Database,
          },
        },
      },
      request: new Request("http://localhost/connect/plaid"),
    } as never);

    expect(result).toEqual({
      kind: "error",
      message:
        "Set PLAID_CLIENT_ID and PLAID_SECRET before launching Plaid Link.",
      title: "Plaid is not configured",
    });
  });

  test("redirects anonymous users before preparing Plaid Link", async () => {
    const loader = createConnectPlaidLoader({
      createPlaidLinkToken: mock(async () => {
        throw new Error("createPlaidLinkToken should not be called");
      }),
      requireViewerContext: mock(async () => {
        throw new Response(null, {
          headers: {
            Location: "/sign-in?redirect_url=%2Fconnect%2Fplaid",
          },
          status: 302,
        });
      }),
    });

    await expect(
      loader({
        context: {
          cloudflare: {
            env: {
              DB: {} as D1Database,
              PLAID_CLIENT_ID: "client-demo",
              PLAID_ENV: "sandbox",
              PLAID_SECRET: "secret-demo",
            },
          },
        },
        request: new Request("http://localhost/connect/plaid"),
      } as never),
    ).rejects.toMatchObject({
      status: 302,
    });
  });
});

describe("connect plaid route action", () => {
  test("exchanges the Link callback token, runs the first sync, and redirects home", async () => {
    const exchangeMock = mock(async () => {
      return {
        connectionId: "conn:plaid:item-demo-101",
        householdId: "household_viewer",
        householdWasCreated: false,
      };
    });
    const syncMock = mock(async () => {
      return {
        recordsChanged: 3,
        runId: "sync:plaid:demo-101",
        status: "succeeded" as const,
      };
    });
    const action = createConnectPlaidAction({
      exchangePlaidPublicToken: exchangeMock,
      requireViewerContext: mock(async () => ({
        clerkUserId: "user_123",
        householdId: "household_viewer",
        householdName: "My Household",
        memberId: "member_viewer",
        memberRole: "owner" as const,
      })),
      syncPlaidConnection: syncMock,
    });
    const formData = new FormData();
    formData.set("publicToken", "public-sandbox-101");
    formData.set("institutionId", "ins_109508");
    formData.set("institutionName", "Vanguard");

    const response = (await action({
      context: {
        cloudflare: {
          env: {
            DB: {} as D1Database,
            PLAID_CLIENT_ID: "client-demo",
            PLAID_ENV: "sandbox",
            PLAID_SECRET: "secret-demo",
          },
        },
      },
      request: new Request("http://localhost/connect/plaid", {
        body: formData,
        method: "POST",
      }),
    } as never)) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
    expect(exchangeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-demo",
        database: {} as D1Database,
        environment: "sandbox",
        institutionId: "ins_109508",
        institutionName: "Vanguard",
        householdId: "household_viewer",
        publicToken: "public-sandbox-101",
        secret: "secret-demo",
      }),
    );
    expect(syncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-demo",
        connectionId: "conn:plaid:item-demo-101",
        database: {} as D1Database,
        environment: "sandbox",
        secret: "secret-demo",
      }),
    );
  });

  test("returns an actionable error when Plaid credentials are missing", async () => {
    const action = createConnectPlaidAction({
      exchangePlaidPublicToken: mock(async () => {
        throw new Error("exchangePlaidPublicToken should not be called");
      }),
      requireViewerContext: mock(async () => ({
        clerkUserId: "user_123",
        householdId: "household_viewer",
        householdName: "My Household",
        memberId: "member_viewer",
        memberRole: "owner" as const,
      })),
      syncPlaidConnection: mock(async () => {
        throw new Error("syncPlaidConnection should not be called");
      }),
    });
    const result = await action({
      context: {
        cloudflare: {
          env: {
            DB: {} as D1Database,
          },
        },
      },
      request: new Request("http://localhost/connect/plaid", {
        method: "POST",
      }),
    } as never);

    expect(result).toEqual({
      message:
        "Set PLAID_CLIENT_ID and PLAID_SECRET before starting Plaid onboarding.",
      ok: false,
    });
  });

  test("redirects anonymous users before exchanging Plaid tokens", async () => {
    const action = createConnectPlaidAction({
      exchangePlaidPublicToken: mock(async () => {
        throw new Error("exchangePlaidPublicToken should not be called");
      }),
      requireViewerContext: mock(async () => {
        throw new Response(null, {
          headers: {
            Location: "/sign-in?redirect_url=%2Fconnect%2Fplaid",
          },
          status: 302,
        });
      }),
      syncPlaidConnection: mock(async () => {
        throw new Error("syncPlaidConnection should not be called");
      }),
    });

    await expect(
      action({
        context: {
          cloudflare: {
            env: {
              DB: {} as D1Database,
              PLAID_CLIENT_ID: "client-demo",
              PLAID_ENV: "sandbox",
              PLAID_SECRET: "secret-demo",
            },
          },
        },
        request: new Request("http://localhost/connect/plaid", {
          method: "POST",
        }),
      } as never),
    ).rejects.toMatchObject({
      status: 302,
    });
  });
});
