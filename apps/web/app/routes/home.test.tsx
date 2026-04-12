import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import Home, { createHomeLoader } from "./home";

type HomeProps = Parameters<typeof Home>[0];

describe("Home route", () => {
  test("loads the homepage snapshot for the authenticated household", async () => {
    const getHomepageSnapshotMock = mock(async () => ({
      changeSummary: null,
      connectionStates: [],
      hasSuccessfulSync: false,
      history: [],
      historyCoverageMode: null,
      historyHasEstimatedPoints: false,
      historyMode: "snapshot" as const,
      householdName: "My Household",
      lastSyncedAt: new Date("2026-04-11T14:00:00.000Z"),
      reportingGroups: [],
      totals: {
        cashMinor: 0,
        investmentsMinor: 0,
        netWorthMinor: 0,
      },
    }));
    const requireViewerContextMock = mock(async () => ({
      clerkUserId: "user_123",
      householdId: "household_viewer",
      householdName: "My Household",
      memberId: "member_viewer",
      memberRole: "owner" as const,
    }));
    const loader = createHomeLoader({
      getHomepageSnapshot: getHomepageSnapshotMock,
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
      request: new Request("http://localhost/"),
    } as never);

    expect(requireViewerContextMock).toHaveBeenCalled();
    expect(getHomepageSnapshotMock).toHaveBeenCalledWith(
      expect.anything(),
      "household_viewer",
    );
    expect(result).toEqual({
      changeSummary: null,
      connectionStates: [],
      hasSuccessfulSync: false,
      history: [],
      historyCoverageMode: null,
      historyHasEstimatedPoints: false,
      historyMode: "snapshot",
      householdId: "household_viewer",
      householdName: "My Household",
      kind: "ready",
      lastSyncedAt: "2026-04-11T14:00:00.000Z",
      reportingGroups: [],
      totals: {
        cashMinor: 0,
        investmentsMinor: 0,
        netWorthMinor: 0,
      },
    });
  });

  test("renders the redesigned product-first dashboard", () => {
    const props = {
      loaderData: {
        changeSummary: {
          netWorthDeltaMinor: 374310,
        },
        connectionStates: [
          {
            configuredConnectionCount: 1,
            lastSuccessfulSyncAt: "2026-03-16T18:30:00.000Z",
            latestRunAt: "2026-03-16T18:30:00.000Z",
            latestRunStatus: "succeeded",
            provider: "plaid",
            status: "active",
          },
        ],
        hasSuccessfulSync: true,
        history: [
          {
            cashMinor: 4700000,
            completedAt: "2026-03-14T18:30:00.000Z",
            coverageMode: "snapshot_only",
            investmentsMinor: 40000000,
            isEstimated: false,
            liabilitiesMinor: -1200000,
            netWorthMinor: 43500000,
          },
          {
            cashMinor: 4812100,
            completedAt: "2026-03-16T18:30:00.000Z",
            coverageMode: "snapshot_only",
            investmentsMinor: 40762210,
            isEstimated: false,
            liabilitiesMinor: -1000000,
            netWorthMinor: 45574310,
          },
        ],
        householdId: "household_demo",
        historyCoverageMode: "snapshot_only",
        historyHasEstimatedPoints: false,
        historyMode: "snapshot",
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

    expect(html).toContain("Welcome back");
    expect(html).toContain("Vista Household");
    expect(html).toContain("Net Worth");
    expect(html).toContain("$455,743.10");
    expect(html).toContain("+$3,743.10");
    expect(html).toContain("Historical trajectory across syncs");
    expect(html).toContain("Connections");
    expect(html).toContain("Portfolio");
    expect(html).toContain("Cash");
    expect(html).toContain("Investments");
    expect(html).toContain("Everyday Checking");
    expect(html).toContain("Taxable Brokerage");
    expect(html).toContain("Plaid");
    expect(html).toContain("Connected");
    expect(html).toContain("/accounts/review");
    expect(html).toContain("/portfolio");
    expect(html).toContain("/connect/plaid?householdId=household_demo");
    expect(html).toContain("/portfolio?householdId=household_demo");
  });

  test("renders chart pending copy when history has fewer than two points", () => {
    const props = {
      loaderData: {
        changeSummary: null,
        connectionStates: [
          {
            configuredConnectionCount: 1,
            lastSuccessfulSyncAt: "2026-03-17T18:30:00.000Z",
            latestRunAt: "2026-03-17T18:30:00.000Z",
            latestRunStatus: "succeeded",
            provider: "plaid",
            status: "active",
          },
        ],
        hasSuccessfulSync: true,
        history: [
          {
            cashMinor: 4982340,
            completedAt: "2026-03-17T18:30:00.000Z",
            coverageMode: "snapshot_only",
            investmentsMinor: 41060510,
            isEstimated: false,
            liabilitiesMinor: -482000,
            netWorthMinor: 46042850,
          },
        ],
        householdId: "household_demo",
        historyCoverageMode: "snapshot_only",
        historyHasEstimatedPoints: false,
        historyMode: "snapshot",
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
            status: "error",
          },
        ],
        hasSuccessfulSync: false,
        history: [],
        householdId: "household_demo",
        historyCoverageMode: null,
        historyHasEstimatedPoints: false,
        historyMode: "snapshot",
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
    expect(html).toContain("2 accounts tracked");
    expect(html).toContain("Cash Pocket");
    expect(html).toContain("Starter Fund");
    expect(html).toContain("Chart available after multiple syncs");
    expect(html).toContain("Error");
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
    expect(html).toContain(
      "Connect your first financial provider to build your household snapshot.",
    );
    expect(html).toContain("/connect/plaid");
  });

  test("renders backfilled history copy and partial-coverage messaging", () => {
    const props = {
      loaderData: {
        changeSummary: null,
        connectionStates: [],
        hasSuccessfulSync: true,
        history: [
          {
            cashMinor: 500000,
            completedAt: "2026-03-14T00:00:00.000Z",
            coverageMode: "mixed_snapshot_and_backfill",
            investmentsMinor: 40000000,
            isEstimated: false,
            liabilitiesMinor: 0,
            netWorthMinor: 40500000,
          },
          {
            cashMinor: 500000,
            completedAt: "2026-03-15T00:00:00.000Z",
            coverageMode: "mixed_snapshot_and_backfill",
            investmentsMinor: 40750000,
            isEstimated: true,
            liabilitiesMinor: 0,
            netWorthMinor: 41250000,
          },
        ],
        historyCoverageMode: "mixed_snapshot_and_backfill",
        historyHasEstimatedPoints: true,
        historyMode: "backfilled",
        householdId: "household_demo",
        householdName: "Vista Household",
        kind: "ready",
        lastSyncedAt: "2026-03-16T18:30:00.000Z",
        reportingGroups: [],
        totals: {
          cashMinor: 500000,
          investmentsMinor: 40750000,
          netWorthMinor: 41250000,
        },
      },
      matches: [],
      params: {},
    } as unknown as HomeProps;

    const html = renderToStaticMarkup(<Home {...props} />);

    expect(html).toContain(
      "Backfilled from investment transactions and daily prices",
    );
    expect(html).toContain("Includes estimated pricing coverage");
    expect(html).toContain("Cash and liabilities remain snapshot-backed");
    expect(html).not.toContain("Chart available after multiple syncs");
    expect(html).toContain("/portfolio?householdId=household_demo");
  });
});
