import { and, desc, eq } from "drizzle-orm";

import type { VistaDb } from "./client";
import {
  accounts,
  balanceSnapshots,
  households,
  type OwnershipType,
  ownershipTypes,
  type ReportingGroup,
  syncRuns,
} from "./schema";

const accountTypeOrder = [
  "checking",
  "savings",
  "credit_card",
  "brokerage",
  "retirement",
  "mortgage",
  "student_loan",
  "loan",
  "line_of_credit",
] as const;

type AccountType = (typeof accountTypeOrder)[number];
type AccountCurationDb = Pick<VistaDb, "query" | "select" | "update">;

export type AccountCurationSnapshot = {
  accounts: Array<{
    accountType: AccountType;
    balanceMinor: number;
    displayName: null | string;
    id: string;
    includeInHouseholdReporting: boolean;
    institutionName: string;
    isHidden: boolean;
    name: string;
    ownershipType: OwnershipType;
    reportingGroup: ReportingGroup;
  }>;
  householdId: string;
  householdName: string;
  lastSyncedAt: Date;
  summary: {
    excludedCount: number;
    hiddenCount: number;
    includedCount: number;
  };
};

export type UpdateAccountCurationArgs = {
  accountId: string;
  displayName: null | string;
  householdId: string;
  includeInHouseholdReporting: boolean;
  isHidden: boolean;
  now?: Date;
  ownershipType: OwnershipType;
};

function assertHouseholdId(
  householdId: null | string | undefined,
): asserts householdId is string {
  if (!householdId?.trim()) {
    throw new Error("Household id is required.");
  }
}

async function resolveHousehold(db: AccountCurationDb, householdId: string) {
  assertHouseholdId(householdId);

  return db.query.households.findFirst({
    where: eq(households.id, householdId),
  });
}

async function resolveLatestSuccessfulRun(
  db: AccountCurationDb,
  householdId: string,
) {
  return db.query.syncRuns.findFirst({
    orderBy: [desc(syncRuns.completedAt), desc(syncRuns.startedAt)],
    where: and(
      eq(syncRuns.householdId, householdId),
      eq(syncRuns.status, "succeeded"),
    ),
  });
}

function sortAccounts(snapshot: AccountCurationSnapshot["accounts"]) {
  return [...snapshot].sort((left, right) => {
    const inclusionDifference =
      Number(right.includeInHouseholdReporting) -
      Number(left.includeInHouseholdReporting);

    if (inclusionDifference !== 0) {
      return inclusionDifference;
    }

    const hiddenDifference = Number(left.isHidden) - Number(right.isHidden);

    if (hiddenDifference !== 0) {
      return hiddenDifference;
    }

    const typeDifference =
      accountTypeOrder.indexOf(left.accountType) -
      accountTypeOrder.indexOf(right.accountType);

    if (typeDifference !== 0) {
      return typeDifference;
    }

    const balanceDifference = right.balanceMinor - left.balanceMinor;

    if (balanceDifference !== 0) {
      return balanceDifference;
    }

    return (left.displayName ?? left.name).localeCompare(
      right.displayName ?? right.name,
    );
  });
}

export async function getAccountCurationSnapshot(
  db: AccountCurationDb,
  householdId: string,
): Promise<AccountCurationSnapshot | null> {
  const household = await resolveHousehold(db, householdId);

  if (!household) {
    return null;
  }

  const latestRun = await resolveLatestSuccessfulRun(db, household.id);
  const rows = latestRun
    ? await db
        .select({
          accountBalanceMinor: accounts.balanceMinor,
          accountType: accounts.accountType,
          displayName: accounts.displayName,
          id: accounts.id,
          includeInHouseholdReporting: accounts.includeInHouseholdReporting,
          institutionName: accounts.institutionName,
          isHidden: accounts.isHidden,
          name: accounts.name,
          ownershipType: accounts.ownershipType,
          reportingGroup: accounts.reportingGroup,
          snapshotBalanceMinor: balanceSnapshots.balanceMinor,
        })
        .from(accounts)
        .leftJoin(
          balanceSnapshots,
          and(
            eq(balanceSnapshots.accountId, accounts.id),
            eq(balanceSnapshots.sourceSyncRunId, latestRun.id),
          ),
        )
        .where(eq(accounts.householdId, household.id))
    : await db
        .select({
          accountBalanceMinor: accounts.balanceMinor,
          accountType: accounts.accountType,
          displayName: accounts.displayName,
          id: accounts.id,
          includeInHouseholdReporting: accounts.includeInHouseholdReporting,
          institutionName: accounts.institutionName,
          isHidden: accounts.isHidden,
          name: accounts.name,
          ownershipType: accounts.ownershipType,
          reportingGroup: accounts.reportingGroup,
          snapshotBalanceMinor: accounts.balanceMinor,
        })
        .from(accounts)
        .where(eq(accounts.householdId, household.id));

  const curatedAccounts = sortAccounts(
    rows.map((row) => ({
      accountType: row.accountType as AccountType,
      balanceMinor: row.snapshotBalanceMinor ?? row.accountBalanceMinor,
      displayName: row.displayName,
      id: row.id,
      includeInHouseholdReporting: row.includeInHouseholdReporting,
      institutionName: row.institutionName,
      isHidden: row.isHidden,
      name: row.name,
      ownershipType: row.ownershipType,
      reportingGroup: row.reportingGroup as ReportingGroup,
    })),
  );

  return {
    accounts: curatedAccounts,
    householdId: household.id,
    householdName: household.name,
    lastSyncedAt: latestRun?.completedAt ?? household.lastSyncedAt,
    summary: {
      excludedCount: curatedAccounts.filter(
        (account) => !account.includeInHouseholdReporting,
      ).length,
      hiddenCount: curatedAccounts.filter((account) => account.isHidden).length,
      includedCount: curatedAccounts.filter(
        (account) => account.includeInHouseholdReporting,
      ).length,
    },
  };
}

export async function updateAccountCuration(
  db: AccountCurationDb,
  args: UpdateAccountCurationArgs,
) {
  const household = await resolveHousehold(db, args.householdId);

  if (!household) {
    throw new Error("No household is available for account curation.");
  }

  if (!ownershipTypes.includes(args.ownershipType)) {
    throw new Error(
      `Unsupported ownership type "${String(args.ownershipType)}".`,
    );
  }

  const normalizedDisplayName = args.displayName?.trim() || null;
  const now = args.now ?? new Date();

  await db
    .update(accounts)
    .set({
      displayName: normalizedDisplayName,
      includeInHouseholdReporting: args.includeInHouseholdReporting,
      isHidden: args.isHidden,
      ownershipType: args.ownershipType,
      updatedAt: now,
    })
    .where(
      and(
        eq(accounts.id, args.accountId),
        eq(accounts.householdId, household.id),
      ),
    );

  const updatedAccount = await db.query.accounts.findFirst({
    where: and(
      eq(accounts.id, args.accountId),
      eq(accounts.householdId, household.id),
    ),
  });

  if (!updatedAccount) {
    throw new Error(`Account ${args.accountId} could not be found.`);
  }

  return {
    accountId: updatedAccount.id,
    effectiveName: updatedAccount.displayName ?? updatedAccount.name,
  };
}
