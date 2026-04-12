import type {
  AccountCurationSnapshot,
  DashboardSnapshot,
  HomepageSnapshot,
  HouseholdStateExport,
  PortfolioSnapshot,
} from "@vista/db";

function asDate(value: null | string | undefined) {
  return value ? new Date(value) : null;
}

export function serializeHouseholdStateExport(snapshot: HouseholdStateExport) {
  return {
    ...snapshot,
    accounts: snapshot.accounts.map((account) => ({
      ...account,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    })),
    balanceSnapshots: snapshot.balanceSnapshots.map((balance) => ({
      ...balance,
      capturedAt: balance.capturedAt.toISOString(),
    })),
    holdings: snapshot.holdings.map((holding) => ({
      ...holding,
      createdAt: holding.createdAt.toISOString(),
      updatedAt: holding.updatedAt.toISOString(),
    })),
    household: {
      ...snapshot.household,
      createdAt: snapshot.household.createdAt.toISOString(),
      lastSyncedAt: snapshot.household.lastSyncedAt.toISOString(),
    },
    holdingSnapshots: snapshot.holdingSnapshots.map((holdingSnapshot) => ({
      ...holdingSnapshot,
      capturedAt: holdingSnapshot.capturedAt.toISOString(),
    })),
    providerAccounts: snapshot.providerAccounts.map((providerAccount) => ({
      ...providerAccount,
      createdAt: providerAccount.createdAt.toISOString(),
      updatedAt: providerAccount.updatedAt.toISOString(),
    })),
    providerConnections: snapshot.providerConnections.map((connection) => ({
      ...connection,
      createdAt: connection.createdAt.toISOString(),
      updatedAt: connection.updatedAt.toISOString(),
    })),
    syncRuns: snapshot.syncRuns.map((run) => ({
      ...run,
      completedAt: run.completedAt?.toISOString() ?? null,
      startedAt: run.startedAt.toISOString(),
    })),
  };
}

export function deserializeHouseholdStateExport(
  value: ReturnType<typeof serializeHouseholdStateExport>,
): HouseholdStateExport {
  return {
    ...value,
    accounts: value.accounts.map((account) => ({
      ...account,
      createdAt: new Date(account.createdAt),
      updatedAt: new Date(account.updatedAt),
    })),
    balanceSnapshots: value.balanceSnapshots.map((balance) => ({
      ...balance,
      capturedAt: new Date(balance.capturedAt),
    })),
    holdings: value.holdings.map((holding) => ({
      ...holding,
      createdAt: new Date(holding.createdAt),
      updatedAt: new Date(holding.updatedAt),
    })),
    household: {
      ...value.household,
      createdAt: new Date(value.household.createdAt),
      lastSyncedAt: new Date(value.household.lastSyncedAt),
    },
    holdingSnapshots: value.holdingSnapshots.map((holdingSnapshot) => ({
      ...holdingSnapshot,
      capturedAt: new Date(holdingSnapshot.capturedAt),
    })),
    providerAccounts: value.providerAccounts.map((providerAccount) => ({
      ...providerAccount,
      createdAt: new Date(providerAccount.createdAt),
      updatedAt: new Date(providerAccount.updatedAt),
    })),
    providerConnections: value.providerConnections.map((connection) => ({
      ...connection,
      createdAt: new Date(connection.createdAt),
      updatedAt: new Date(connection.updatedAt),
    })),
    syncRuns: value.syncRuns.map((run) => ({
      ...run,
      completedAt: asDate(run.completedAt),
      startedAt: new Date(run.startedAt),
    })),
  };
}

export function serializeHomepageSnapshot(snapshot: HomepageSnapshot | null) {
  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot,
    connectionStates: snapshot.connectionStates.map((state) => ({
      ...state,
      lastSuccessfulSyncAt: state.lastSuccessfulSyncAt?.toISOString() ?? null,
      latestRunAt: state.latestRunAt?.toISOString() ?? null,
    })),
    lastSyncedAt: snapshot.lastSyncedAt.toISOString(),
  };
}

export function deserializeHomepageSnapshot(
  snapshot: ReturnType<typeof serializeHomepageSnapshot>,
): HomepageSnapshot | null {
  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot,
    connectionStates: snapshot.connectionStates.map((state) => ({
      ...state,
      lastSuccessfulSyncAt: asDate(state.lastSuccessfulSyncAt),
      latestRunAt: asDate(state.latestRunAt),
    })),
    lastSyncedAt: new Date(snapshot.lastSyncedAt),
  };
}

export function serializeDashboardSnapshot(snapshot: DashboardSnapshot | null) {
  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot,
    changeSummary: snapshot.changeSummary
      ? {
          ...snapshot.changeSummary,
          comparedToCompletedAt:
            snapshot.changeSummary.comparedToCompletedAt.toISOString(),
        }
      : null,
    lastSyncedAt: snapshot.lastSyncedAt.toISOString(),
  };
}

export function deserializeDashboardSnapshot(
  snapshot: ReturnType<typeof serializeDashboardSnapshot>,
): DashboardSnapshot | null {
  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot,
    changeSummary: snapshot.changeSummary
      ? {
          ...snapshot.changeSummary,
          comparedToCompletedAt: new Date(
            snapshot.changeSummary.comparedToCompletedAt,
          ),
        }
      : null,
    lastSyncedAt: new Date(snapshot.lastSyncedAt),
  };
}

export function serializePortfolioSnapshot(snapshot: PortfolioSnapshot | null) {
  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot,
    lastSyncedAt: snapshot.lastSyncedAt.toISOString(),
  };
}

export function deserializePortfolioSnapshot(
  snapshot: ReturnType<typeof serializePortfolioSnapshot>,
): PortfolioSnapshot | null {
  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot,
    lastSyncedAt: new Date(snapshot.lastSyncedAt),
  };
}

export function serializeAccountCurationSnapshot(
  snapshot: AccountCurationSnapshot | null,
) {
  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot,
    lastSyncedAt: snapshot.lastSyncedAt.toISOString(),
  };
}

export function deserializeAccountCurationSnapshot(
  snapshot: ReturnType<typeof serializeAccountCurationSnapshot>,
): AccountCurationSnapshot | null {
  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot,
    lastSyncedAt: new Date(snapshot.lastSyncedAt),
  };
}
