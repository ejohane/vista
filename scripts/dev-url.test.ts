import { describe, expect, test } from "bun:test";

import { readLocalHttpsRedirectUrl, rewriteUrlPort } from "./dev-url";

describe("readLocalHttpsRedirectUrl", () => {
  test("returns null when the redirect URL is missing", () => {
    expect(readLocalHttpsRedirectUrl({})).toBeNull();
  });

  test("returns null for non-Tailscale HTTPS redirect URLs", () => {
    expect(
      readLocalHttpsRedirectUrl({
        PLAID_REDIRECT_URI: "https://example.com:8443/connect/plaid",
      }),
    ).toBeNull();
  });

  test("returns the parsed redirect URL for local Tailscale HTTPS callbacks", () => {
    const redirectUrl = readLocalHttpsRedirectUrl({
      PLAID_REDIRECT_URI:
        "https://eriks-macbook-pro.taild079c8.ts.net:8443/connect/plaid?mode=oauth",
    });

    expect(redirectUrl?.hostname).toBe("eriks-macbook-pro.taild079c8.ts.net");
    expect(redirectUrl?.port).toBe("8443");
    expect(redirectUrl?.pathname).toBe("/connect/plaid");
    expect(redirectUrl?.searchParams.get("mode")).toBe("oauth");
  });
});

describe("rewriteUrlPort", () => {
  test("replaces the port without changing the rest of the URL", () => {
    const rewrittenUrl = rewriteUrlPort(
      new URL(
        "https://eriks-macbook-pro.taild079c8.ts.net:8443/connect/plaid?mode=oauth",
      ),
      8444,
    );

    expect(rewrittenUrl.toString()).toBe(
      "https://eriks-macbook-pro.taild079c8.ts.net:8444/connect/plaid?mode=oauth",
    );
  });
});
