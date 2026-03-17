import { and, desc, eq, inArray } from "drizzle-orm";

import type { VistaDb } from "./client";
import { accounts, balanceSnapshots, households, syncRuns } from "./schema";

const accountTypeLabels = {
  brokerage: "Brokerage",
  checking: "Checking",
  retirement: "Retirement",
  savings: "Savings",
} as const;

const accountTypeReportingGroups = {
  brokerage: "investments",
  checking: "cash",
  retirement: "investments",
  savings: "cash",
} as const;

const accountTypeKeys = Object.keys(accountTypeLabels) as Array<
  keyof typeof accountTypeLabels
>;
const reportingGroupOrder = ["cash", "investments"] as const;

type DashboardDb = Pick<VistaDb, "query" | "select">;
type ReportingGroup = (typeof reportingGroupOrder)[number];
type HouseholdAccountSnapshot = {
  accountId: string;
  accountType: keyof typeof accountTypeLabels;
  balanceMinor: number;
  institutionName: string;
  name: string;
  reportingGroup: ReportingGroup;
  sourceSyncRunId: string;
};
type SyncRunSummary = {
  completedAt: Date | null;
  id: string;
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
  changeSummary: null | {
    cashDeltaMinor: number;
    changedAccounts: Array<{
      accountType: keyof typeof accountTypeLabels;
      deltaMinor: number;
      id: string;
      institutionName: string;
      latestBalanceMinor: number;
      name: string;
      previousBalanceMinor: number;
    }>;
    changedGroups: Array<{
      deltaMinor: number;
      key: keyof typeof accountTypeLabels;
      label: (typeof accountTypeLabels)[keyof typeof accountTypeLabels];
      latestTotalMinor: number;
      previousTotalMinor: number;
    }>;
    comparedToCompletedAt: Date;
    investmentsDeltaMinor: number;
    netWorthDeltaMinor: number;
  };
  householdName: string;
  lastSyncedAt: Date;
  totals: {
    cashMinor: number;
    investmentsMinor: number;
    netWorthMinor: number;
  };
};

function assertValidAccount(
  account: HouseholdAccountSnapshot,
  householdId: string,
): asserts account is HouseholdAccountSnapshot {
  const expectedReportingGroup =
    accountTypeReportingGroups[account.accountType];

  if (expectedReportingGroup === undefined) {
    throw new Error(
      `Account ${account.accountId} for household ${householdId} has unsupported account type "${String(account.accountType)}".`,
    );
  }

  if (account.reportingGroup !== expectedReportingGroup) {
    throw new Error(
      `Account ${account.accountId} for household ${householdId} uses reporting group "${account.reportingGroup}" but "${account.accountType}" accounts must be "${expectedReportingGroup}".`,
    );
  }
}

function buildTotals(accountsForTotals: HouseholdAccountSnapshot[]) {
  return accountsForTotals.reduce(
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
}

function buildAccountTypeGroups(accountsForGroups: HouseholdAccountSnapshot[]) {
  return Object.entries(
    accountsForGroups.reduce<
      Record<
        keyof typeof accountTypeLabels,
        {
          accounts: HouseholdAccountSnapshot[];
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
        .map(({ sourceSyncRunId: _, ...account }) => ({
          accountType: account.accountType,
          balanceMinor: account.balanceMinor,
          id: account.accountId,
          institutionName: account.institutionName,
          name: account.name,
        }))
        .sort((left, right) => right.balanceMinor - left.balanceMinor),
      key: key as keyof typeof accountTypeLabels,
      label: accountTypeLabels[key as keyof typeof accountTypeLabels],
      totalMinor: group.totalMinor,
    }));
}

function createAccountTypeTotals() {
  return {
    brokerage: 0,
    checking: 0,
    retirement: 0,
    savings: 0,
  } satisfies Record<keyof typeof accountTypeLabels, number>;
}

function buildChangeSummary(
  _latestRun: SyncRunSummary,
  previousRun: SyncRunSummary | undefined,
  latestAccounts: HouseholdAccountSnapshot[],
  previousAccounts: HouseholdAccountSnapshot[],
): DashboardSnapshot["changeSummary"] {
  if (!previousRun?.completedAt) {
    return null;
  }

  const latestTotals = buildTotals(latestAccounts);
  const previousTotals = buildTotals(previousAccounts);

  const latestTypeTotals = latestAccounts.reduce((result, account) => {
    result[account.accountType] += account.balanceMinor;
    return result;
  }, createAccountTypeTotals());

  const previousTypeTotals = previousAccounts.reduce((result, account) => {
    result[account.accountType] += account.balanceMinor;
    return result;
  }, createAccountTypeTotals());

  const latestByAccountId = new Map(
    latestAccounts.map((account) => [account.accountId, account]),
  );
  const previousByAccountId = new Map(
    previousAccounts.map((account) => [account.accountId, account]),
  );
  const changedAccounts = Array.from(
    new Set([...latestByAccountId.keys(), ...previousByAccountId.keys()]),
  )
    .map((accountId) => {
      const latestAccount = latestByAccountId.get(accountId);
      const previousAccount = previousByAccountId.get(accountId);
      const account = latestAccount ?? previousAccount;

      if (!account) {
        return null;
      }

      const latestBalanceMinor = latestAccount?.balanceMinor ?? 0;
      const previousBalanceMinor = previousAccount?.balanceMinor ?? 0;
      const deltaMinor = latestBalanceMinor - previousBalanceMinor;

      if (deltaMinor === 0) {
        return null;
      }

      return {
        accountType: account.accountType,
        deltaMinor,
        id: account.accountId,
        institutionName: account.institutionName,
        latestBalanceMinor,
        name: account.name,
        previousBalanceMinor,
      };
    })
    .filter((account) => account !== null)
    .sort((left, right) => {
      const deltaDifference =
        Math.abs(right.deltaMinor) - Math.abs(left.deltaMinor);

      if (deltaDifference !== 0) {
        return deltaDifference;
      }

      return left.name.localeCompare(right.name);
    })
    .slice(0, 3);

  const changedGroups = accountTypeKeys
    .map((key) => {
      const latestTotalMinor = latestTypeTotals[key];
      const previousTotalMinor = previousTypeTotals[key];
      const deltaMinor = latestTotalMinor - previousTotalMinor;

      if (deltaMinor === 0) {
        return null;
      }

      return {
        deltaMinor,
        key,
        label: accountTypeLabels[key],
        latestTotalMinor,
        previousTotalMinor,
      };
    })
    .filter((group) => group !== null)
    .sort((left, right) => {
      const deltaDifference =
        Math.abs(right.deltaMinor) - Math.abs(left.deltaMinor);

      if (deltaDifference !== 0) {
        return deltaDifference;
      }

      return left.label.localeCompare(right.label);
    });

  return {
    cashDeltaMinor: latestTotals.cashMinor - previousTotals.cashMinor,
    changedAccounts,
    changedGroups,
    comparedToCompletedAt: previousRun.completedAt,
    investmentsDeltaMinor:
      latestTotals.investmentsMinor - previousTotals.investmentsMinor,
    netWorthDeltaMinor:
      latestTotals.netWorthMinor - previousTotals.netWorthMinor,
  };
}

export async function getDashboardSnapshot(
  db: DashboardDb,
  householdId?: string,
): Promise<DashboardSnapshot | null> {
  const household = householdId
    ? await db.query.households.findFirst({
        where: eq(households.id, householdId),
      })
    : await db.query.households.findFirst();

  if (!household) {
    return null;
  }

  const resolvedHouseholdId = household.id;
  const successfulRuns = (
    await db
      .select({
        completedAt: syncRuns.completedAt,
        id: syncRuns.id,
      })
      .from(syncRuns)
      .where(
        and(
          eq(syncRuns.householdId, resolvedHouseholdId),
          eq(syncRuns.status, "succeeded"),
        ),
      )
      .orderBy(desc(syncRuns.completedAt), desc(syncRuns.startedAt))
      .limit(2)
  ).filter((run): run is { completedAt: Date; id: string } => {
    return run.completedAt instanceof Date;
  });

  const latestRun = successfulRuns[0];

  if (!latestRun) {
    return {
      accountTypeGroups: [],
      changeSummary: null,
      householdName: household.name,
      lastSyncedAt: household.lastSyncedAt,
      totals: { cashMinor: 0, investmentsMinor: 0, netWorthMinor: 0 },
    };
  }

  const runIds = successfulRuns.map((run) => run.id);
  const snapshotRows = await db
    .select({
      accountId: accounts.id,
      accountType: accounts.accountType,
      balanceMinor: balanceSnapshots.balanceMinor,
      institutionName: accounts.institutionName,
      name: accounts.name,
      reportingGroup: accounts.reportingGroup,
      sourceSyncRunId: balanceSnapshots.sourceSyncRunId,
    })
    .from(balanceSnapshots)
    .innerJoin(
      accounts,
      and(
        eq(balanceSnapshots.accountId, accounts.id),
        eq(accounts.householdId, resolvedHouseholdId),
      ),
    )
    .where(inArray(balanceSnapshots.sourceSyncRunId, runIds));

  snapshotRows.forEach((account) => {
    assertValidAccount(account, resolvedHouseholdId);
  });

  const latestAccounts = snapshotRows.filter(
    (account) => account.sourceSyncRunId === latestRun.id,
  );
  const previousRun = successfulRuns[1];
  const previousAccounts = previousRun
    ? snapshotRows.filter(
        (account) => account.sourceSyncRunId === previousRun.id,
      )
    : [];

  return {
    accountTypeGroups: buildAccountTypeGroups(latestAccounts),
    changeSummary: buildChangeSummary(
      latestRun,
      previousRun,
      latestAccounts,
      previousAccounts,
    ),
    householdName: household.name,
    lastSyncedAt: latestRun.completedAt,
    totals: buildTotals(latestAccounts),
  };
}
