import { describe, expect, test } from "bun:test";

import { normalizeAppRedirectUrl, rethrowRouteResponse } from "./redirects";

describe("normalizeAppRedirectUrl", () => {
  test("keeps valid in-app redirect paths", () => {
    expect(normalizeAppRedirectUrl("/portfolio?tab=allocation")).toBe(
      "/portfolio?tab=allocation",
    );
  });

  test("rejects empty or external redirect values", () => {
    expect(normalizeAppRedirectUrl(null)).toBe("/");
    expect(normalizeAppRedirectUrl("")).toBe("/");
    expect(normalizeAppRedirectUrl("https://example.com")).toBe("/");
    expect(normalizeAppRedirectUrl("//example.com")).toBe("/");
  });
});

describe("rethrowRouteResponse", () => {
  test("rethrows redirects and other route responses", () => {
    const response = new Response(null, {
      headers: { Location: "/sign-in" },
      status: 302,
    });

    try {
      rethrowRouteResponse(response);
      throw new Error("Expected route response to be rethrown.");
    } catch (error) {
      expect(error).toBe(response);
      expect((error as Response).status).toBe(302);
      expect((error as Response).headers.get("Location")).toBe("/sign-in");
    }
  });

  test("ignores non-response errors", () => {
    expect(() => rethrowRouteResponse(new Error("boom"))).not.toThrow();
  });
});
