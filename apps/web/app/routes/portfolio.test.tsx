import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PortfolioScreen } from "./portfolio";

describe("portfolio route", () => {
  test("renders a populated portfolio allocation view", () => {
    const html = renderToStaticMarkup(
      <PortfolioScreen
        loaderData={{
          accounts: [
            {
              accountId: "acct_brokerage",
              accountType: "brokerage",
              holdings: [
                {
                  assetClass: "equity",
                  assetClassLabel: "Equities",
                  holdingId: "holding_vti",
                  marketValueMinor: 300000,
                  name: "Vanguard Total Stock Market ETF",
                  quantity: "10",
                  symbol: "VTI",
                },
              ],
              institutionName: "Vanguard",
              marketValueMinor: 372012,
              name: "Taxable Brokerage",
            },
          ],
          allocationBuckets: [
            {
              holdingCount: 2,
              key: "equity",
              label: "Equities",
              marketValueMinor: 400000,
            },
            {
              holdingCount: 1,
              key: "cash",
              label: "Cash",
              marketValueMinor: 53012,
            },
          ],
          asOfDate: "2026-03-18",
          householdName: "Vista Household",
          kind: "ready",
          lastSyncedAt: "2026-03-18T18:30:00.000Z",
          topHoldings: [
            {
              accountName: "Taxable Brokerage",
              assetClass: "equity",
              assetClassLabel: "Equities",
              holdingId: "holding_vti",
              marketValueMinor: 300000,
              name: "Vanguard Total Stock Market ETF",
              quantity: "10",
              symbol: "VTI",
            },
          ],
          totals: {
            accountCount: 2,
            costBasisMinor: 431012,
            holdingCount: 5,
            marketValueMinor: 493012,
            unrealizedGainMinor: 62000,
          },
        }}
      />,
    );

    expect(html).toContain("Portfolio composition");
    expect(html).toContain("Total invested");
    expect(html).toContain("Unrealized gain");
    expect(html).toContain("Equities");
    expect(html).toContain("Top holdings");
    expect(html).toContain("Vanguard Total Stock Market ETF");
    expect(html).toContain("/accounts/review");
  });

  test("renders the empty portfolio state when no holdings exist yet", () => {
    const html = renderToStaticMarkup(
      <PortfolioScreen
        loaderData={{
          kind: "empty",
        }}
      />,
    );

    expect(html).toContain("Portfolio composition");
    expect(html).toContain("No investment holdings yet");
    expect(html).toContain("Connect Plaid");
    expect(html).toContain("/connect/plaid");
    expect(html).toContain("/");
  });
});
