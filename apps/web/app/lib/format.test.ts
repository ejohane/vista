import { describe, expect, test } from "bun:test";

import { formatCompactUsd, formatUpdatedAt, formatUsd } from "@/lib/format";

describe("formatUsd", () => {
  test("formats positive minor-unit amounts", () => {
    expect(formatUsd(24311890)).toBe("$243,118.90");
  });

  test("formats negative minor-unit amounts", () => {
    expect(formatUsd(-501)).toBe("-$5.01");
  });
});

describe("formatCompactUsd", () => {
  test("formats dashboard-scale totals compactly", () => {
    expect(formatCompactUsd(24311890)).toBe("$243.1K");
  });
});

describe("formatUpdatedAt", () => {
  test("produces a readable timestamp", () => {
    expect(formatUpdatedAt("2026-03-16T18:30:00.000Z")).toContain("2026");
  });
});
