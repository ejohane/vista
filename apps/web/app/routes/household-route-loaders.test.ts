import { describe, expect, mock, test } from "bun:test";

import {
  createAccountReviewAction,
  createAccountReviewLoader,
} from "./account-review";
import { createHomeLoader } from "./home";
import { createPortfolioLoader } from "./portfolio";

const resolvedHousehold = {
  id: "household_demo",
  lastSyncedAt: new Date("2026-03-16T18:30:00.000Z"),
  name: "Vista Household",
};

describe("household route loaders", () => {
  test("home loader resolves household once and reads through the household service", async () => {
    const getHomepageSnapshot = mock(async () => ({
      changeSummary: null,
      connectionStates: [],
      hasSuccessfulSync: false,
      history: [],
      householdName: "Vista Household",
      lastSyncedAt: new Date("2026-03-16T18:30:00.000Z"),
      reportingGroups: [],
      totals: {
        cashMinor: 0,
        investmentsMinor: 0,
        netWorthMinor: 0,
      },
    }));

    const loader = createHomeLoader({
      createHouseholdAccess: () => ({
        getHousehold: async () => resolvedHousehold,
        listHouseholds: async () => [resolvedHousehold],
      }),
      createHouseholdService: () => ({
        getHomepageSnapshot,
      }),
      resolveHouseholdSelection: mock(async () => resolvedHousehold),
    });

    const result = await loader({
      context: { cloudflare: { env: { DB: {} as D1Database } } },
      request: new Request("http://localhost/?householdId=household_demo"),
    } as never);

    expect(getHomepageSnapshot).toHaveBeenCalledWith("household_demo");
    expect(result).toEqual(
      expect.objectContaining({
        householdId: "household_demo",
        kind: "ready",
      }),
    );
  });

  test("portfolio loader resolves household once and reads through the household service", async () => {
    const getPortfolioSnapshot = mock(async () => ({
      accounts: [],
      allocationBuckets: [],
      asOfDate: "2026-03-18",
      householdName: "Vista Household",
      lastSyncedAt: new Date("2026-03-18T18:30:00.000Z"),
      topHoldings: [],
      totals: {
        accountCount: 0,
        costBasisMinor: 0,
        holdingCount: 0,
        marketValueMinor: 0,
        unrealizedGainMinor: 0,
      },
    }));

    const loader = createPortfolioLoader({
      createHouseholdAccess: () => ({
        getHousehold: async () => resolvedHousehold,
        listHouseholds: async () => [resolvedHousehold],
      }),
      createHouseholdService: () => ({
        getPortfolioSnapshot,
      }),
      resolveHouseholdSelection: mock(async () => resolvedHousehold),
    });

    const result = await loader({
      context: { cloudflare: { env: { DB: {} as D1Database } } },
      request: new Request(
        "http://localhost/portfolio?householdId=household_demo",
      ),
    } as never);

    expect(getPortfolioSnapshot).toHaveBeenCalledWith("household_demo");
    expect(result).toEqual(
      expect.objectContaining({
        householdId: "household_demo",
        kind: "ready",
      }),
    );
  });

  test("account review loader and action both use the resolved household id", async () => {
    const getAccountCurationSnapshot = mock(async () => ({
      accounts: [],
      householdId: "household_demo",
      householdName: "Vista Household",
      lastSyncedAt: new Date("2026-03-16T18:30:00.000Z"),
      summary: {
        excludedCount: 0,
        hiddenCount: 0,
        includedCount: 0,
      },
    }));
    const updateAccountCuration = mock(async () => ({
      accountId: "acct_checking",
      effectiveName: "Household Operating",
    }));

    const createHouseholdAccess = () => ({
      getHousehold: async () => resolvedHousehold,
      listHouseholds: async () => [resolvedHousehold],
    });
    const createHouseholdService = () => ({
      getAccountCurationSnapshot,
      updateAccountCuration,
    });
    const resolveHouseholdSelection = mock(async () => resolvedHousehold);

    const loader = createAccountReviewLoader({
      createHouseholdAccess,
      createHouseholdService,
      resolveHouseholdSelection,
    });
    const action = createAccountReviewAction({
      createHouseholdAccess,
      createHouseholdService,
      resolveHouseholdSelection,
    });

    const loaderResult = await loader({
      context: { cloudflare: { env: { DB: {} as D1Database } } },
      request: new Request(
        "http://localhost/accounts/review?householdId=household_demo",
      ),
    } as never);

    expect(getAccountCurationSnapshot).toHaveBeenCalledWith("household_demo");
    expect(loaderResult).toEqual(
      expect.objectContaining({
        householdId: "household_demo",
        kind: "ready",
      }),
    );

    const formData = new FormData();
    formData.set("accountId", "acct_checking");
    formData.set("displayName", "Household Operating");
    formData.set("ownershipType", "mine");
    formData.set("isHidden", "on");

    const response = (await action({
      context: { cloudflare: { env: { DB: {} as D1Database } } },
      request: new Request(
        "http://localhost/accounts/review?householdId=household_demo",
        {
          body: formData,
          method: "POST",
        },
      ),
    } as never)) as Response;

    expect(updateAccountCuration).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "acct_checking",
        householdId: "household_demo",
      }),
    );
    expect(response.headers.get("Location")).toBe(
      "/accounts/review?householdId=household_demo&updated=acct_checking",
    );
  });
});
