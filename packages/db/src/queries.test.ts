import { describe, expect, test } from "bun:test";

import type { VistaDb } from "./client";
import { getDashboardSnapshot } from "./queries";

function createMockDb(): VistaDb {
  return {
    query: {
      households: {
        findFirst: async () => ({
          createdAt: new Date("2026-03-16T12:00:00.000Z"),
          id: "household_demo",
          lastSyncedAt: new Date("2026-03-16T18:30:00.000Z"),
          name: "Vista Household",
        }),
      },
    },
    select: () => ({
      from: () => ({
        where: async () => [
          {
            accountType: "checking",
            balanceMinor: 1284500,
            id: "acct_checking",
            institutionName: "US Bank",
            name: "Everyday Checking",
            reportingGroup: "cash",
          },
          {
            accountType: "savings",
            balanceMinor: 3527600,
            id: "acct_savings",
            institutionName: "US Bank",
            name: "Rainy Day Savings",
            reportingGroup: "cash",
          },
          {
            accountType: "brokerage",
            balanceMinor: 16450320,
            id: "acct_brokerage",
            institutionName: "Vanguard",
            name: "Taxable Brokerage",
            reportingGroup: "investments",
          },
          {
            accountType: "retirement",
            balanceMinor: 24311890,
            id: "acct_retirement",
            institutionName: "Vanguard",
            name: "Rollover IRA",
            reportingGroup: "investments",
          },
        ],
      }),
    }),
  } as unknown as VistaDb;
}

describe("getDashboardSnapshot", () => {
  test("aggregates household totals and groups accounts", async () => {
    const snapshot = await getDashboardSnapshot(
      createMockDb(),
      "household_demo",
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot?.householdName).toBe("Vista Household");
    expect(snapshot?.totals).toEqual({
      cashMinor: 4812100,
      investmentsMinor: 40762210,
      netWorthMinor: 45574310,
    });
    expect(snapshot?.accountTypeGroups.map((group) => group.key)).toEqual([
      "checking",
      "savings",
      "brokerage",
      "retirement",
    ]);
  });

  test("returns null when the household cannot be found", async () => {
    const db = {
      query: {
        households: {
          findFirst: async () => null,
        },
      },
    } as unknown as VistaDb;

    await expect(getDashboardSnapshot(db, "missing")).resolves.toBeNull();
  });
});
