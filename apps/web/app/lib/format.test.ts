import { describe, expect, test } from "bun:test";

import {
  formatCompactUsd,
  formatSignedUsd,
  formatUpdatedAt,
  formatUsd,
} from "@/lib/format";

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

describe("formatSignedUsd", () => {
  test("formats positive and negative deltas with explicit signs", () => {
    expect(formatSignedUsd(374310)).toBe("+$3,743.10");
    expect(formatSignedUsd(-501)).toBe("-$5.01");
  });
});

describe("formatUpdatedAt", () => {
  test("produces a deterministic UTC timestamp", () => {
    expect(formatUpdatedAt("2026-03-16T18:30:00.000Z")).toBe(
      "Mar 16, 2026 at 6:30 PM UTC",
    );
  });
});
