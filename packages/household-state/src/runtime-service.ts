import {
  createD1HouseholdService,
  exportHouseholdState,
  getDb,
} from "@vista/db";

import type { HouseholdStateMode } from "./mode";

type HouseholdStateClient = ReturnType<
  typeof import("./client").createHouseholdStateClient
>;

function isEqualSnapshot(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function ensureHouseholdStateHydrated(args: {
  client: HouseholdStateClient;
  database: D1Database;
  householdId: string;
}) {
  const status = await args.client.getStatus(args.householdId);

  if (status.initialized) {
    return;
  }

  const snapshot = await exportHouseholdState(args.database, args.householdId);

  if (!snapshot) {
    return;
  }

  await args.client.importHouseholdState(args.householdId, snapshot);
}

export function createRuntimeHouseholdService(args: {
  client: HouseholdStateClient | null;
  database: D1Database;
  mode: HouseholdStateMode;
  onParityMismatch?: (args: {
    householdId: string;
    legacy: unknown;
    operation: string;
    state: unknown;
  }) => void;
}) {
  const legacyService = createD1HouseholdService(getDb(args.database));

  const compare = (
    operation: string,
    householdId: string,
    legacy: unknown,
    state: unknown,
  ) => {
    if (isEqualSnapshot(legacy, state)) {
      return;
    }

    args.onParityMismatch?.({
      householdId,
      legacy,
      operation,
      state,
    });
  };

  return {
    async getAccountCurationSnapshot(householdId: string) {
      if (args.mode === "legacy" || !args.client) {
        return legacyService.getAccountCurationSnapshot(householdId);
      }

      await ensureHouseholdStateHydrated({
        client: args.client,
        database: args.database,
        householdId,
      });
      const stateSnapshot =
        await args.client.getAccountCurationSnapshot(householdId);

      if (args.mode === "dual") {
        const legacySnapshot =
          await legacyService.getAccountCurationSnapshot(householdId);
        compare(
          "getAccountCurationSnapshot",
          householdId,
          legacySnapshot,
          stateSnapshot,
        );
      }

      return stateSnapshot;
    },

    async getDashboardSnapshot(householdId: string) {
      if (args.mode === "legacy" || !args.client) {
        return legacyService.getDashboardSnapshot(householdId);
      }

      await ensureHouseholdStateHydrated({
        client: args.client,
        database: args.database,
        householdId,
      });
      const stateSnapshot = await args.client.getDashboardSnapshot(householdId);

      if (args.mode === "dual") {
        const legacySnapshot =
          await legacyService.getDashboardSnapshot(householdId);
        compare(
          "getDashboardSnapshot",
          householdId,
          legacySnapshot,
          stateSnapshot,
        );
      }

      return stateSnapshot;
    },

    async getHomepageSnapshot(householdId: string) {
      if (args.mode === "legacy" || !args.client) {
        return legacyService.getHomepageSnapshot(householdId);
      }

      await ensureHouseholdStateHydrated({
        client: args.client,
        database: args.database,
        householdId,
      });
      const stateSnapshot = await args.client.getHomepageSnapshot(householdId);

      if (args.mode === "dual") {
        const legacySnapshot =
          await legacyService.getHomepageSnapshot(householdId);
        compare(
          "getHomepageSnapshot",
          householdId,
          legacySnapshot,
          stateSnapshot,
        );
      }

      return stateSnapshot;
    },

    async getPortfolioSnapshot(householdId: string) {
      if (args.mode === "legacy" || !args.client) {
        return legacyService.getPortfolioSnapshot(householdId);
      }

      await ensureHouseholdStateHydrated({
        client: args.client,
        database: args.database,
        householdId,
      });
      const stateSnapshot = await args.client.getPortfolioSnapshot(householdId);

      if (args.mode === "dual") {
        const legacySnapshot =
          await legacyService.getPortfolioSnapshot(householdId);
        compare(
          "getPortfolioSnapshot",
          householdId,
          legacySnapshot,
          stateSnapshot,
        );
      }

      return stateSnapshot;
    },

    async updateAccountCuration(
      argsForUpdate: Parameters<typeof legacyService.updateAccountCuration>[0],
    ) {
      if (args.mode === "legacy" || !args.client) {
        return legacyService.updateAccountCuration(argsForUpdate);
      }

      await ensureHouseholdStateHydrated({
        client: args.client,
        database: args.database,
        householdId: argsForUpdate.householdId,
      });

      if (args.mode === "dual") {
        const legacyResult =
          await legacyService.updateAccountCuration(argsForUpdate);
        const stateResult =
          await args.client.updateAccountCuration(argsForUpdate);
        compare(
          "updateAccountCuration",
          argsForUpdate.householdId,
          legacyResult,
          stateResult,
        );
        return stateResult;
      }

      return args.client.updateAccountCuration(argsForUpdate);
    },
  };
}
