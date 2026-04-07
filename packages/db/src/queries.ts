import { and, desc, eq, inArray } from "drizzle-orm";

import type { VistaDb } from "./client";
import {
  accounts,
  balanceSnapshots,
  households,
  type ProviderConnectionStatus,
  type ProviderType,
  providerConnections,
  type SyncRunStatus,
  syncRuns,
} from "./schema";

const homepageProviderTypes = ["plaid"] as const satisfies ProviderType[];

const accountTypeLabels = {
  brokerage: "Brokerage",
  checking: "Checking",
  credit_card: "Credit Card",
  line_of_credit: "Line of Credit",
  loan: "Loan",
  mortgage: "Mortgage",
  retirement: "Retirement",
  savings: "Savings",
  student_loan: "Student Loan",
} as const;

const accountTypeReportingGroups = {
  brokerage: "investments",
  checking: "cash",
  credit_card: "liabilities",
  line_of_credit: "liabilities",
  loan: "liabilities",
  mortgage: "liabilities",
  retirement: "investments",
  savings: "cash",
  student_loan: "liabilities",
} as const;

const accountTypeKeys = Object.keys(accountTypeLabels) as Array<
  keyof typeof accountTypeLabels
>;
const reportingGroupOrder = ["cash", "liabilities", "investments"] as const;
const homepageReportingGroupLabels = {
  cash: "Cash",
  investments: "Investments",
  liabilities: "Liabilities",
} as const;
const homepageReportingGroupOrder = [
  "cash",
  "investments",
  "liabilities",
] as const;

type DashboardDb = Pick<VistaDb, "query" | "select">;
type ReportingGroup = (typeof reportingGroupOrder)[number];
type HouseholdAccountSnapshot = {
  accountId: string;
  accountType: keyof typeof accountTypeLabels;
  balanceMinor: number;
  includeInHouseholdReporting: boolean;
  institutionName: string;
  isHidden: boolean;
  name: string;
  reportingGroup: ReportingGroup;
  sourceSyncRunId: string;
};
type SyncRunSummary = {
  completedAt: Date | null;
  id: string;
};

type ResolvedHousehold = {
  id: string;
  lastSyncedAt: Date;
  name: string;
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
  hasSuccessfulSync: boolean;
  householdName: string;
  lastSyncedAt: Date;
  totals: {
    cashMinor: number;
    investmentsMinor: number;
    netWorthMinor: number;
  };
};

export type HomepageSnapshot = {
  changeSummary: null | {
    netWorthDeltaMinor: number;
  };
  connectionStates: Array<{
    configuredConnectionCount: number;
    lastSuccessfulSyncAt: Date | null;
    latestRunAt: Date | null;
    latestRunStatus: "never" | SyncRunStatus;
    provider: ProviderType;
    status: ProviderConnectionStatus | "not_connected";
  }>;
  hasSuccessfulSync: boolean;
  history: NetWorthHistoryPoint[];
  householdName: string;
  lastSyncedAt: Date;
  reportingGroups: Array<{
    accounts: Array<{
      balanceMinor: number;
      id: string;
      institutionName: string;
      name: string;
    }>;
    key: ReportingGroup;
    label: (typeof homepageReportingGroupLabels)[ReportingGroup];
    totalMinor: number;
  }>;
  totals: {
    cashMinor: number;
    investmentsMinor: number;
    netWorthMinor: number;
  };
};

async function resolveHousehold(
  db: DashboardDb,
  householdId?: string,
): Promise<ResolvedHousehold | null> {
  return householdId
    ? ((await db.query.households.findFirst({
        where: eq(households.id, householdId),
      })) ?? null)
    : ((await db.query.households.findFirst()) ?? null);
}

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

function filterReportingAccounts(
  accountsForReporting: HouseholdAccountSnapshot[],
) {
  return accountsForReporting.filter(
    (account) => account.includeInHouseholdReporting,
  );
}

function filterVisibleAccounts(
  accountsForPresentation: HouseholdAccountSnapshot[],
) {
  return accountsForPresentation.filter((account) => !account.isHidden);
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
        credit_card: { accounts: [], totalMinor: 0 },
        line_of_credit: { accounts: [], totalMinor: 0 },
        loan: { accounts: [], totalMinor: 0 },
        mortgage: { accounts: [], totalMinor: 0 },
        retirement: { accounts: [], totalMinor: 0 },
        savings: { accounts: [], totalMinor: 0 },
        student_loan: { accounts: [], totalMinor: 0 },
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

function buildHomepageReportingGroups(
  accountTypeGroups: DashboardSnapshot["accountTypeGroups"],
): HomepageSnapshot["reportingGroups"] {
  const grouped = new Map<
    ReportingGroup,
    HomepageSnapshot["reportingGroups"][number]
  >();

  for (const group of accountTypeGroups) {
    const reportingGroup = accountTypeReportingGroups[group.key];
    const accounts = group.accounts.map(
      ({ accountType: _, ...account }) => account,
    );
    const existing = grouped.get(reportingGroup);

    if (existing) {
      existing.accounts.push(...accounts);
      existing.totalMinor += group.totalMinor;
      continue;
    }

    grouped.set(reportingGroup, {
      accounts,
      key: reportingGroup,
      label: homepageReportingGroupLabels[reportingGroup],
      totalMinor: group.totalMinor,
    });
  }

  return homepageReportingGroupOrder
    .map((key) => grouped.get(key))
    .filter(
      (group): group is HomepageSnapshot["reportingGroups"][number] =>
        group !== undefined && group.accounts.length > 0,
    )
    .map((group) => ({
      ...group,
      accounts: [...group.accounts].sort(
        (left, right) => right.balanceMinor - left.balanceMinor,
      ),
    }));
}

function createAccountTypeTotals() {
  return {
    brokerage: 0,
    checking: 0,
    credit_card: 0,
    line_of_credit: 0,
    loan: 0,
    mortgage: 0,
    retirement: 0,
    savings: 0,
    student_loan: 0,
  } satisfies Record<keyof typeof accountTypeLabels, number>;
}

async function loadHouseholdAccounts(
  db: DashboardDb,
  householdId: string,
): Promise<HouseholdAccountSnapshot[]> {
  const accountRows = await db
    .select({
      accountId: accounts.id,
      accountType: accounts.accountType,
      balanceMinor: accounts.balanceMinor,
      displayName: accounts.displayName,
      includeInHouseholdReporting: accounts.includeInHouseholdReporting,
      institutionName: accounts.institutionName,
      isHidden: accounts.isHidden,
      name: accounts.name,
      reportingGroup: accounts.reportingGroup,
      sourceSyncRunId: accounts.id,
    })
    .from(accounts)
    .where(eq(accounts.householdId, householdId));

  const normalizedRows = accountRows.map((account) => ({
    ...account,
    name: account.displayName ?? account.name,
  }));

  normalizedRows.forEach((account) => {
    assertValidAccount(account, householdId);
  });

  return normalizedRows;
}

async function loadHomepageConnectionStates(
  db: DashboardDb,
  householdId: string,
): Promise<HomepageSnapshot["connectionStates"]> {
  const [connectionRows, runRows] = await Promise.all([
    db
      .select({
        accessToken: providerConnections.accessToken,
        accessSecret: providerConnections.accessSecret,
        accessUrl: providerConnections.accessUrl,
        provider: providerConnections.provider,
        status: providerConnections.status,
      })
      .from(providerConnections)
      .where(eq(providerConnections.householdId, householdId)),
    db
      .select({
        completedAt: syncRuns.completedAt,
        provider: syncRuns.provider,
        startedAt: syncRuns.startedAt,
        status: syncRuns.status,
      })
      .from(syncRuns)
      .where(eq(syncRuns.householdId, householdId))
      .orderBy(desc(syncRuns.completedAt), desc(syncRuns.startedAt)),
  ]);

  return homepageProviderTypes.map((provider) => {
    const providerConnectionsForProvider = connectionRows.filter(
      (connection) => connection.provider === provider,
    );
    const configuredConnectionCount = providerConnectionsForProvider.filter(
      (connection) =>
        connection.status === "active" && Boolean(connection.accessToken),
    ).length;
    const status: HomepageSnapshot["connectionStates"][number]["status"] =
      configuredConnectionCount > 0
        ? "active"
        : providerConnectionsForProvider.some(
              (connection) => connection.status === "error",
            )
          ? "error"
          : providerConnectionsForProvider.some(
                (connection) => connection.status === "disconnected",
              )
            ? "disconnected"
            : "not_connected";
    const runsForProvider = runRows.filter((run) => run.provider === provider);
    const latestRun = runsForProvider[0];
    const lastSuccessfulRun = runsForProvider.find(
      (run): run is typeof run & { completedAt: Date } =>
        run.status === "succeeded" && run.completedAt instanceof Date,
    );

    return {
      configuredConnectionCount,
      lastSuccessfulSyncAt: lastSuccessfulRun?.completedAt ?? null,
      latestRunAt: latestRun?.completedAt ?? latestRun?.startedAt ?? null,
      latestRunStatus: latestRun?.status ?? "never",
      provider,
      status,
    };
  });
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
    filterVisibleAccounts(latestAccounts).map((account) => [
      account.accountId,
      account,
    ]),
  );
  const previousByAccountId = new Map(
    filterVisibleAccounts(previousAccounts).map((account) => [
      account.accountId,
      account,
    ]),
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
  const household = await resolveHousehold(db, householdId);

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
    const legacyAccounts = filterReportingAccounts(
      await loadHouseholdAccounts(db, resolvedHouseholdId),
    );

    return {
      accountTypeGroups: buildAccountTypeGroups(
        filterVisibleAccounts(legacyAccounts),
      ),
      changeSummary: null,
      hasSuccessfulSync: false,
      householdName: household.name,
      lastSyncedAt: household.lastSyncedAt,
      totals: buildTotals(legacyAccounts),
    };
  }

  const runIds = successfulRuns.map((run) => run.id);
  const snapshotRows = await db
    .select({
      accountId: accounts.id,
      accountType: accounts.accountType,
      balanceMinor: balanceSnapshots.balanceMinor,
      displayName: accounts.displayName,
      includeInHouseholdReporting: accounts.includeInHouseholdReporting,
      institutionName: accounts.institutionName,
      isHidden: accounts.isHidden,
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

  const normalizedSnapshotRows = snapshotRows.map((account) => ({
    ...account,
    name: account.displayName ?? account.name,
  }));

  normalizedSnapshotRows.forEach((account) => {
    assertValidAccount(account, resolvedHouseholdId);
  });

  const latestAccounts = normalizedSnapshotRows.filter(
    (account) => account.sourceSyncRunId === latestRun.id,
  );
  const previousRun = successfulRuns[1];
  const previousAccounts = previousRun
    ? normalizedSnapshotRows.filter(
        (account) => account.sourceSyncRunId === previousRun.id,
      )
    : [];
  const latestReportingAccounts = filterReportingAccounts(latestAccounts);
  const previousReportingAccounts = filterReportingAccounts(previousAccounts);

  return {
    accountTypeGroups: buildAccountTypeGroups(
      filterVisibleAccounts(latestReportingAccounts),
    ),
    changeSummary: buildChangeSummary(
      latestRun,
      previousRun,
      latestReportingAccounts,
      previousReportingAccounts,
    ),
    hasSuccessfulSync: true,
    householdName: household.name,
    lastSyncedAt: latestRun.completedAt,
    totals: buildTotals(latestReportingAccounts),
  };
}

export type NetWorthHistoryPoint = {
  cashMinor: number;
  completedAt: string;
  investmentsMinor: number;
  liabilitiesMinor: number;
  netWorthMinor: number;
};

export async function getNetWorthHistory(
  db: DashboardDb,
  householdId?: string,
  limit = 30,
): Promise<NetWorthHistoryPoint[]> {
  const household = await resolveHousehold(db, householdId);

  if (!household) {
    return [];
  }

  const resolvedHouseholdId = household.id;

  const runs = await db
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
    .limit(limit);

  const validRuns = runs.filter(
    (run): run is { completedAt: Date; id: string } =>
      run.completedAt instanceof Date,
  );

  if (!validRuns.length) {
    return [];
  }

  const runIds = validRuns.map((run) => run.id);

  const snapshotRows = await db
    .select({
      accountId: accounts.id,
      balanceMinor: balanceSnapshots.balanceMinor,
      includeInHouseholdReporting: accounts.includeInHouseholdReporting,
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

  const pointsByRun = new Map<
    string,
    {
      cashMinor: number;
      investmentsMinor: number;
      liabilitiesMinor: number;
      netWorthMinor: number;
    }
  >();

  for (const row of snapshotRows) {
    if (!row.includeInHouseholdReporting) continue;

    let point = pointsByRun.get(row.sourceSyncRunId);
    if (!point) {
      point = {
        cashMinor: 0,
        investmentsMinor: 0,
        liabilitiesMinor: 0,
        netWorthMinor: 0,
      };
      pointsByRun.set(row.sourceSyncRunId, point);
    }

    point.netWorthMinor += row.balanceMinor;

    if (row.reportingGroup === "cash") {
      point.cashMinor += row.balanceMinor;
    } else if (row.reportingGroup === "investments") {
      point.investmentsMinor += row.balanceMinor;
    } else if (row.reportingGroup === "liabilities") {
      point.liabilitiesMinor += row.balanceMinor;
    }
  }

  return validRuns
    .filter((run) => pointsByRun.has(run.id))
    .map((run) => {
      const point = pointsByRun.get(run.id);
      if (!point) {
        return null;
      }

      return {
        ...point,
        completedAt: run.completedAt.toISOString(),
      };
    })
    .filter((point) => point !== null)
    .reverse();
}

export async function getHomepageSnapshot(
  db: DashboardDb,
  householdId?: string,
): Promise<HomepageSnapshot | null> {
  const household = await resolveHousehold(db, householdId);

  if (!household) {
    return null;
  }

  const resolvedHouseholdId = household.id;
  const [dashboard, history, connectionStates] = await Promise.all([
    getDashboardSnapshot(db, resolvedHouseholdId),
    getNetWorthHistory(db, resolvedHouseholdId),
    loadHomepageConnectionStates(db, resolvedHouseholdId),
  ]);

  if (!dashboard) {
    return null;
  }

  return {
    changeSummary: dashboard.changeSummary
      ? {
          netWorthDeltaMinor: dashboard.changeSummary.netWorthDeltaMinor,
        }
      : null,
    connectionStates,
    hasSuccessfulSync: dashboard.hasSuccessfulSync,
    history,
    householdName: dashboard.householdName,
    lastSyncedAt: dashboard.lastSyncedAt,
    reportingGroups: buildHomepageReportingGroups(dashboard.accountTypeGroups),
    totals: dashboard.totals,
  };
}
