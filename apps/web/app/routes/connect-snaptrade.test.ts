import { describe, expect, mock, test } from "bun:test";

import { createConnectSnaptradeAction } from "./connect-snaptrade";

describe("connect snaptrade route action", () => {
  test("starts the connection portal flow and redirects to SnapTrade", async () => {
    const beginMock = mock(async () => {
      return {
        connectionDraftId: "conn:snaptrade:draft:draft-101",
        householdId: "household_default",
        householdWasCreated: true,
        redirectUri: "https://app.snaptrade.com/snapTrade/redeemToken?demo=1",
      };
    });
    const action = createConnectSnaptradeAction({
      beginSnaptradeConnection: beginMock,
    });

    const response = (await action({
      context: {
        cloudflare: {
          env: {
            DB: {} as D1Database,
            SNAPTRADE_CLIENT_ID: "client-demo",
            SNAPTRADE_CONSUMER_KEY: "consumer-demo",
          },
        },
      },
      request: new Request("http://localhost/connect/snaptrade", {
        method: "POST",
      }),
    } as never)) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://app.snaptrade.com/snapTrade/redeemToken?demo=1",
    );
    expect(beginMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientFactory: expect.any(Function),
        clientId: "client-demo",
        consumerKey: "consumer-demo",
        database: {} as D1Database,
        redirectUrl: "http://localhost/connect/snaptrade/callback",
      }),
    );
  });

  test("returns an actionable error when the SnapTrade credentials are not configured in the web worker env", async () => {
    const action = createConnectSnaptradeAction({
      beginSnaptradeConnection: mock(async () => {
        throw new Error("beginSnaptradeConnection should not be called");
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
      request: new Request("http://localhost/connect/snaptrade", {
        method: "POST",
      }),
    } as never);

    expect(result).toEqual({
      message:
        "Set SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY before starting SnapTrade onboarding.",
      ok: false,
    });
  });
});
