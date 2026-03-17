import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import Home from "./home";

type HomeProps = Parameters<typeof Home>[0];

describe("Home route", () => {
  test("renders a populated change summary when comparison data exists", () => {
    const props = {
      loaderData: {
        accountTypeGroups: [
          {
            accounts: [
              {
                accountType: "checking",
                balanceMinor: 1284500,
                id: "acct_checking",
                institutionName: "US Bank",
                name: "Everyday Checking",
              },
            ],
            key: "checking",
            label: "Checking",
            totalMinor: 1284500,
          },
        ],
        changeSummary: {
          cashDeltaMinor: 72100,
          changedAccounts: [
            {
              accountType: "brokerage",
              deltaMinor: 270320,
              id: "acct_brokerage",
              institutionName: "Vanguard",
              latestBalanceMinor: 16450320,
              name: "Taxable Brokerage",
              previousBalanceMinor: 16180000,
            },
            {
              accountType: "checking",
              deltaMinor: 44500,
              id: "acct_checking",
              institutionName: "US Bank",
              latestBalanceMinor: 1284500,
              name: "Everyday Checking",
              previousBalanceMinor: 1240000,
            },
          ],
          changedGroups: [
            {
              deltaMinor: 270320,
              key: "brokerage",
              label: "Brokerage",
              latestTotalMinor: 16450320,
              previousTotalMinor: 16180000,
            },
          ],
          comparedToCompletedAt: "2026-03-15T18:30:00.000Z",
          investmentsDeltaMinor: 302210,
          netWorthDeltaMinor: 374310,
        },
        householdName: "Vista Household",
        kind: "ready",
        lastSyncedAt: "2026-03-16T18:30:00.000Z",
        totals: {
          cashMinor: 4812100,
          investmentsMinor: 40762210,
          netWorthMinor: 45574310,
        },
      },
      matches: [],
      params: {},
    } as unknown as HomeProps;

    const html = renderToStaticMarkup(<Home {...props} />);

    expect(html).toContain("Compact change summary");
    expect(html).toContain(
      "Brokerage drove the biggest move higher compared with Mar 15, 2026 at 6:30 PM UTC, led by Taxable Brokerage and Everyday Checking.",
    );
    expect(html).toContain("Compared to Mar 15, 2026 at 6:30 PM UTC");
    expect(html).toContain("+$3,743.10");
    expect(html).toContain("+$721.00");
    expect(html).toContain("Largest account moves");
  });

  test("renders the explicit empty state when only one successful run exists", () => {
    const props = {
      loaderData: {
        accountTypeGroups: [],
        changeSummary: null,
        householdName: "Vista Household",
        kind: "ready",
        lastSyncedAt: "2026-03-17T18:30:00.000Z",
        totals: {
          cashMinor: 4982340,
          investmentsMinor: 41060510,
          netWorthMinor: 46042850,
        },
      },
      matches: [],
      params: {},
    } as unknown as HomeProps;

    const html = renderToStaticMarkup(<Home {...props} />);

    expect(html).toContain("Compact change summary");
    expect(html).toContain("Waiting for another sync");
    expect(html).toContain("Change summary available after the next sync");
    expect(html).not.toContain("Compared to Mar");
  });
});
