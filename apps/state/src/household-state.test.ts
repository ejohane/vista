import { describe, expect, test } from "bun:test";

import { decodePathSegment } from "./household-state";

describe("decodePathSegment", () => {
  test("decodes encoded provider connection ids before lookup", () => {
    expect(decodePathSegment("conn%3Aplaid%3Aitem-demo-101")).toBe(
      "conn:plaid:item-demo-101",
    );
  });

  test("rejects malformed encoded path segments", () => {
    expect(() => decodePathSegment("%")).toThrow(URIError);
  });
});
