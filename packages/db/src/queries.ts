import { eq } from "drizzle-orm";

import type { VistaDb } from "./client";
import { accounts, households } from "./schema";

const accountTypeLabels = {
  brokerage: "Brokerage",
  checking: "Checking",
  retirement: "Retirement",
  savings: "Savings",
} as const;

const reportingGroupOrder = ["cash", "investments"] as const;
type ReportingGroup = (typeof reportingGroupOrder)[number];
type HouseholdAccount = {
  accountType: keyof typeof accountTypeLabels;
  balanceMinor: number;
  id: string;
  institutionName: string;
  name: string;
  reportingGroup: ReportingGroup;
};

export type DashboardSnapshot = {
  accountTypeGroups: Array<{
    accounts: Array<{
      accountType: keyof typeof accountTypeLabels;
      balanceMinor: number;
      id: string;
      institutionName: string;
      name: string;
    }>;
    key: keyof typeof accountTypeLabels;
    label: (typeof accountTypeLabels)[keyof typeof accountTypeLabels];
    totalMinor: number;
  }>;
  householdName: string;
  lastSyncedAt: Date;
  totals: {
    cashMinor: number;
    investmentsMinor: number;
    netWorthMinor: number;
  };
};

export async function getDashboardSnapshot(
  db: VistaDb,
  householdId: string,
): Promise<DashboardSnapshot | null> {
  const household = await db.query.households.findFirst({
    where: eq(households.id, householdId),
  });

  if (!household) {
    return null;
  }

  const householdAccounts = await db
    .select({
      accountType: accounts.accountType,
      balanceMinor: accounts.balanceMinor,
      id: accounts.id,
      institutionName: accounts.institutionName,
      name: accounts.name,
      reportingGroup: accounts.reportingGroup,
    })
    .from(accounts)
    .where(eq(accounts.householdId, householdId));

  const totals = householdAccounts.reduce(
    (result, account) => {
      result.netWorthMinor += account.balanceMinor;

      if (account.reportingGroup === "cash") {
        result.cashMinor += account.balanceMinor;
      }

      if (account.reportingGroup === "investments") {
        result.investmentsMinor += account.balanceMinor;
      }

      return result;
    },
    { cashMinor: 0, investmentsMinor: 0, netWorthMinor: 0 },
  );

  const accountTypeGroups = Object.entries(
    householdAccounts.reduce<
      Record<
        keyof typeof accountTypeLabels,
        {
          accounts: HouseholdAccount[];
          totalMinor: number;
        }
      >
    >(
      (result, account) => {
        const existingGroup = result[account.accountType];

        if (existingGroup) {
          existingGroup.accounts.push(account);
          existingGroup.totalMinor += account.balanceMinor;
          return result;
        }

        result[account.accountType] = {
          accounts: [account],
          totalMinor: account.balanceMinor,
        };

        return result;
      },
      {
        brokerage: { accounts: [], totalMinor: 0 },
        checking: { accounts: [], totalMinor: 0 },
        retirement: { accounts: [], totalMinor: 0 },
        savings: { accounts: [], totalMinor: 0 },
      },
    ),
  )
    .filter(([, group]) => group.accounts.length > 0)
    .sort((left, right) => {
      const leftGroup = left[1].accounts[0]?.reportingGroup ?? "cash";
      const rightGroup = right[1].accounts[0]?.reportingGroup ?? "cash";
      const groupDifference =
        reportingGroupOrder.indexOf(leftGroup) -
        reportingGroupOrder.indexOf(rightGroup);

      if (groupDifference !== 0) {
        return groupDifference;
      }

      return left[0].localeCompare(right[0]);
    })
    .map(([key, group]) => ({
      accounts: group.accounts
        .map(({ reportingGroup: _, ...account }) => account)
        .sort((left, right) => right.balanceMinor - left.balanceMinor),
      key: key as keyof typeof accountTypeLabels,
      label: accountTypeLabels[key as keyof typeof accountTypeLabels],
      totalMinor: group.totalMinor,
    }));

  return {
    accountTypeGroups,
    householdName: household.name,
    lastSyncedAt: household.lastSyncedAt,
    totals,
  };
}
