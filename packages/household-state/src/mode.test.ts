import { afterEach, describe, expect, test } from "bun:test";

import {
  createHouseholdStateClientFromEnv,
  readHouseholdStateMode,
} from "./mode";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("readHouseholdStateMode", () => {
  test("uses state mode when a base URL is configured", () => {
    expect(
      readHouseholdStateMode({
        HOUSEHOLD_STATE_BASE_URL: "http://127.0.0.1:8789",
      }),
    ).toBe("state");
  });
});

describe("createHouseholdStateClientFromEnv", () => {
  test("routes requests through the configured base URL", async () => {
    let requestedUrl: string | null = null;

    globalThis.fetch = (async (input) => {
      requestedUrl = input instanceof Request ? input.url : String(input);

      return new Response(
        JSON.stringify({
          accountCount: 0,
          initialized: false,
          syncRunCount: 0,
        }),
        {
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as typeof fetch;

    const client = createHouseholdStateClientFromEnv({
      HOUSEHOLD_STATE_BASE_URL: "http://127.0.0.1:8789",
    });

    expect(client).not.toBeNull();

    await client?.getStatus("household_demo");

    if (!requestedUrl) {
      throw new Error("Expected the client to issue a fetch request.");
    }

    expect(String(requestedUrl)).toBe(
      "http://127.0.0.1:8789/households/household_demo/status",
    );
  });
});
