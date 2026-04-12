import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { createPortfolioLoader, PortfolioScreen } from "./portfolio";

describe("portfolio route", () => {
  test("loads the portfolio for the authenticated household", async () => {
    const getPortfolioSnapshotMock = mock(async () => ({
      accounts: [],
      allocationBuckets: [],
      asOfDate: "2026-04-11",
      householdName: "My Household",
      lastSyncedAt: new Date("2026-04-11T14:00:00.000Z"),
      topHoldings: [],
      totals: {
        accountCount: 0,
        costBasisMinor: 0,
        holdingCount: 0,
        marketValueMinor: 0,
        unrealizedGainMinor: 0,
      },
    }));
    const requireViewerContextMock = mock(async () => ({
      clerkUserId: "user_123",
      householdId: "household_viewer",
      householdName: "My Household",
      memberId: "member_viewer",
      memberRole: "owner" as const,
    }));
    const loader = createPortfolioLoader({
      getPortfolioSnapshot: getPortfolioSnapshotMock,
      requireViewerContext: requireViewerContextMock,
    });

    const result = await loader({
      context: {
        cloudflare: {
          env: {
            DB: {} as D1Database,
          },
        },
      },
      request: new Request("http://localhost/portfolio"),
    } as never);

    expect(requireViewerContextMock).toHaveBeenCalled();
    expect(getPortfolioSnapshotMock).toHaveBeenCalledWith(
      expect.anything(),
      "household_viewer",
    );
    expect(result).toEqual({
      accounts: [],
      allocationBuckets: [],
      asOfDate: "2026-04-11",
      householdId: "household_viewer",
      householdName: "My Household",
      kind: "ready",
      lastSyncedAt: "2026-04-11T14:00:00.000Z",
      topHoldings: [],
      totals: {
        accountCount: 0,
        costBasisMinor: 0,
        holdingCount: 0,
        marketValueMinor: 0,
        unrealizedGainMinor: 0,
      },
    });
  });

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
          householdId: "household_demo",
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

    expect(html).toContain("Investment Portfolio");
    expect(html).toContain("Market value");
    expect(html).toContain("Unrealized gain");
    expect(html).toContain("Asset Allocation");
    expect(html).toContain("Top Holdings");
    expect(html).toContain("Account Sleeves");
    expect(html).toContain("Vanguard Total Stock Market ETF");
    expect(html).toContain("Taxable Brokerage");
  });

  test("renders the empty portfolio state when no holdings exist yet", () => {
    const html = renderToStaticMarkup(
      <PortfolioScreen
        loaderData={{
          householdId: "household_demo",
          kind: "empty",
        }}
      />,
    );

    expect(html).toContain("Investment Portfolio");
    expect(html).toContain("No holdings yet");
    expect(html).toContain("Connect Plaid");
    expect(html).toContain("/connect/plaid?householdId=household_demo");
  });
});
