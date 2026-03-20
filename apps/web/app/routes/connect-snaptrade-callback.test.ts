import { describe, expect, mock, test } from "bun:test";

import { createConnectSnaptradeCallbackLoader } from "./connect-snaptrade-callback";

describe("connect snaptrade callback route loader", () => {
  test("finalizes the connection, runs the first sync, and redirects into the portfolio view", async () => {
    const completeMock = mock(async () => {
      return {
        brokerageName: "Vanguard",
        connectionId: "conn:snaptrade:draft:draft-201",
        householdId: "household_default",
        status: "active" as const,
      };
    });
    const syncMock = mock(async () => {
      return {
        recordsChanged: 8,
        runId: "sync:snaptrade:demo",
        status: "succeeded" as const,
      };
    });
    const loader = createConnectSnaptradeCallbackLoader({
      completeSnaptradeConnection: completeMock,
      syncSnaptradeConnection: syncMock,
    });

    const response = (await loader({
      context: {
        cloudflare: {
          env: {
            DB: {} as D1Database,
            SNAPTRADE_CLIENT_ID: "client-demo",
            SNAPTRADE_CONSUMER_KEY: "consumer-demo",
          },
        },
      },
      request: new Request(
        "http://localhost/connect/snaptrade/callback?status=SUCCESS&connection_id=authorization-201&draftConnectionId=conn:snaptrade:draft:draft-201",
      ),
    } as never)) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/portfolio");
    expect(completeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackConnectionId: "authorization-201",
        clientFactory: expect.any(Function),
        clientId: "client-demo",
        connectionDraftId: "conn:snaptrade:draft:draft-201",
        consumerKey: "consumer-demo",
        database: {} as D1Database,
      }),
    );
    expect(syncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientFactory: expect.any(Function),
        clientId: "client-demo",
        connectionId: "conn:snaptrade:draft:draft-201",
        consumerKey: "consumer-demo",
        database: {} as D1Database,
      }),
    );
  });

  test("returns an actionable error when the callback succeeded but the first sync failed", async () => {
    const loader = createConnectSnaptradeCallbackLoader({
      completeSnaptradeConnection: mock(async () => {
        return {
          brokerageName: "Vanguard",
          connectionId: "conn:snaptrade:draft:draft-202",
          householdId: "household_default",
          status: "active" as const,
        };
      }),
      syncSnaptradeConnection: mock(async () => {
        throw new Error("SnapTrade holdings import returned 502.");
      }),
    });

    const result = await loader({
      context: {
        cloudflare: {
          env: {
            DB: {} as D1Database,
            SNAPTRADE_CLIENT_ID: "client-demo",
            SNAPTRADE_CONSUMER_KEY: "consumer-demo",
          },
        },
      },
      request: new Request(
        "http://localhost/connect/snaptrade/callback?status=SUCCESS&connection_id=authorization-202&draftConnectionId=conn:snaptrade:draft:draft-202",
      ),
    } as never);

    expect(result).toEqual({
      message:
        "SnapTrade connection was saved, but the first sync failed: SnapTrade holdings import returned 502.",
      ok: false,
      title: "SnapTrade connected but sync failed",
    });
  });

  test("surfaces the provider callback error without touching the database", async () => {
    const completeMock = mock(async () => {
      throw new Error("completeSnaptradeConnection should not be called");
    });
    const loader = createConnectSnaptradeCallbackLoader({
      completeSnaptradeConnection: completeMock,
      syncSnaptradeConnection: mock(async () => {
        throw new Error("syncSnaptradeConnection should not be called");
      }),
    });

    const result = await loader({
      context: {
        cloudflare: {
          env: {
            DB: {} as D1Database,
            SNAPTRADE_CLIENT_ID: "client-demo",
            SNAPTRADE_CONSUMER_KEY: "consumer-demo",
          },
        },
      },
      request: new Request(
        "http://localhost/connect/snaptrade/callback?status=ERROR&status_code=503&error_code=BROKERAGE_UNAVAILABLE&draftConnectionId=conn:snaptrade:draft:draft-203",
      ),
    } as never);

    expect(result).toEqual({
      message: "SnapTrade returned ERROR (BROKERAGE_UNAVAILABLE / 503).",
      ok: false,
      title: "SnapTrade connection failed",
    });
    expect(completeMock).toHaveBeenCalledTimes(0);
  });
});
