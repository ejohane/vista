import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import Home from "./home";

type HomeProps = Parameters<typeof Home>[0];

describe("Home route", () => {
  test("renders the redesigned product-first dashboard", () => {
    const props = {
      loaderData: {
        changeSummary: {
          netWorthDeltaMinor: 374310,
        },
        connectionStates: [
          {
            configuredConnectionCount: 0,
            lastSuccessfulSyncAt: null,
            latestRunAt: null,
            latestRunStatus: "never",
            provider: "plaid",
            status: "not_connected",
          },
          {
            configuredConnectionCount: 1,
            lastSuccessfulSyncAt: "2026-03-16T18:30:00.000Z",
            latestRunAt: "2026-03-16T18:30:00.000Z",
            latestRunStatus: "succeeded",
            provider: "simplefin",
            status: "active",
          },
          {
            configuredConnectionCount: 0,
            lastSuccessfulSyncAt: null,
            latestRunAt: null,
            latestRunStatus: "never",
            provider: "snaptrade",
            status: "not_connected",
          },
        ],
        hasSuccessfulSync: true,
        history: [
          {
            cashMinor: 4700000,
            completedAt: "2026-03-14T18:30:00.000Z",
            investmentsMinor: 40000000,
            liabilitiesMinor: -1200000,
            netWorthMinor: 43500000,
          },
          {
            cashMinor: 4812100,
            completedAt: "2026-03-16T18:30:00.000Z",
            investmentsMinor: 40762210,
            liabilitiesMinor: -1000000,
            netWorthMinor: 45574310,
          },
        ],
        householdName: "Vista Household",
        kind: "ready",
        lastSyncedAt: "2026-03-16T18:30:00.000Z",
        reportingGroups: [
          {
            accounts: [
              {
                balanceMinor: 1284500,
                id: "acct_checking",
                institutionName: "US Bank",
                name: "Everyday Checking",
              },
            ],
            key: "cash",
            label: "Cash",
            totalMinor: 4812100,
          },
          {
            accounts: [
              {
                balanceMinor: 16450320,
                id: "acct_brokerage",
                institutionName: "Vanguard",
                name: "Taxable Brokerage",
              },
            ],
            key: "investments",
            label: "Investments",
            totalMinor: 40762210,
          },
        ],
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

    expect(html).toContain("Net Worth");
    expect(html).toContain("$455.7K");
    expect(html).toContain("+$3,743.10");
    expect(html).toContain("Portfolio");
    expect(html).toContain("Cash");
    expect(html).toContain("Investments");
    expect(html).toContain("Everyday Checking");
    expect(html).toContain("Taxable Brokerage");
    expect(html).toContain("Plaid");
    expect(html).toContain("SimpleFIN");
    expect(html).toContain("SnapTrade");
    expect(html).toContain("Connected");
    expect(html).toContain("Not connected");
    expect(html).toContain("/accounts/review");
    expect(html).toContain("/portfolio");
    expect(html).toContain("/connect/plaid");
    expect(html).toContain("/connect/simplefin");
    expect(html).toContain("/connect/snaptrade");
  });

  test("renders chart pending copy when history has fewer than two points", () => {
    const props = {
      loaderData: {
        changeSummary: null,
        connectionStates: [
          {
            configuredConnectionCount: 0,
            lastSuccessfulSyncAt: null,
            latestRunAt: null,
            latestRunStatus: "never",
            provider: "plaid",
            status: "not_connected",
          },
          {
            configuredConnectionCount: 1,
            lastSuccessfulSyncAt: "2026-03-17T18:30:00.000Z",
            latestRunAt: "2026-03-17T18:30:00.000Z",
            latestRunStatus: "succeeded",
            provider: "simplefin",
            status: "active",
          },
          {
            configuredConnectionCount: 0,
            lastSuccessfulSyncAt: null,
            latestRunAt: null,
            latestRunStatus: "never",
            provider: "snaptrade",
            status: "not_connected",
          },
        ],
        hasSuccessfulSync: true,
        history: [
          {
            cashMinor: 4982340,
            completedAt: "2026-03-17T18:30:00.000Z",
            investmentsMinor: 41060510,
            liabilitiesMinor: -482000,
            netWorthMinor: 46042850,
          },
        ],
        householdName: "Vista Household",
        kind: "ready",
        lastSyncedAt: "2026-03-17T18:30:00.000Z",
        reportingGroups: [],
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

    expect(html).toContain("Chart available after multiple syncs");
    expect(html).not.toContain("+$");
  });

  test("renders compact stats and account count from grouped accounts", () => {
    const props = {
      loaderData: {
        changeSummary: null,
        connectionStates: [
          {
            configuredConnectionCount: 0,
            lastSuccessfulSyncAt: null,
            latestRunAt: null,
            latestRunStatus: "never",
            provider: "plaid",
            status: "not_connected",
          },
          {
            configuredConnectionCount: 0,
            lastSuccessfulSyncAt: null,
            latestRunAt: null,
            latestRunStatus: "never",
            provider: "simplefin",
            status: "not_connected",
          },
          {
            configuredConnectionCount: 0,
            lastSuccessfulSyncAt: null,
            latestRunAt: null,
            latestRunStatus: "never",
            provider: "snaptrade",
            status: "error",
          },
        ],
        hasSuccessfulSync: false,
        history: [],
        householdName: "Vista Household",
        kind: "ready",
        lastSyncedAt: "2026-03-15T18:30:00.000Z",
        reportingGroups: [
          {
            accounts: [
              {
                balanceMinor: 187,
                id: "acct1",
                institutionName: "Demo Bank",
                name: "Cash Pocket",
              },
              {
                balanceMinor: 143,
                id: "acct2",
                institutionName: "Demo Broker",
                name: "Starter Fund",
              },
            ],
            key: "cash",
            label: "Cash",
            totalMinor: 330,
          },
        ],
        totals: {
          cashMinor: 187,
          investmentsMinor: 143,
          netWorthMinor: 330,
        },
      },
      matches: [],
      params: {},
    } as unknown as HomeProps;

    const html = renderToStaticMarkup(<Home {...props} />);

    expect(html).toContain("Accounts");
    expect(html).toContain(">2<");
    expect(html).toContain("Cash Pocket");
    expect(html).toContain("Starter Fund");
    expect(html).toContain(
      "Using current account balances while the first sync comes online",
    );
    expect(html).toContain("Needs attention");
  });

  test("renders the seeded empty state when no household snapshot exists", () => {
    const props = {
      loaderData: {
        kind: "empty",
        nextStepCommand: "bun run db:seed:local",
      },
      matches: [],
      params: {},
    } as unknown as HomeProps;

    const html = renderToStaticMarkup(<Home {...props} />);

    expect(html).toContain("Welcome to Vista");
    expect(html).toContain("bun run db:seed:local");
    expect(html).toContain("/connect/plaid");
    expect(html).toContain("/connect/simplefin");
    expect(html).toContain("/connect/snaptrade");
  });
});
