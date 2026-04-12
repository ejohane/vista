import { describe, expect, test } from "bun:test";

import { normalizeAppRedirectUrl } from "./redirects";

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
