import type {
  AccountCurationSnapshot,
  UpdateAccountCurationArgs,
} from "./account-curation";
import {
  getAccountCurationSnapshot,
  updateAccountCuration,
} from "./account-curation";
import type { VistaDb } from "./client";
import { getPortfolioSnapshot, type PortfolioSnapshot } from "./portfolio";
import {
  type DashboardSnapshot,
  getDashboardSnapshot,
  getHomepageSnapshot,
  type HomepageSnapshot,
} from "./queries";

type HouseholdServiceDb = Pick<VistaDb, "query" | "select" | "update">;

export type HouseholdService = {
  getAccountCurationSnapshot: (
    householdId: string,
  ) => Promise<AccountCurationSnapshot | null>;
  getDashboardSnapshot: (
    householdId: string,
  ) => Promise<DashboardSnapshot | null>;
  getHomepageSnapshot: (
    householdId: string,
  ) => Promise<HomepageSnapshot | null>;
  getPortfolioSnapshot: (
    householdId: string,
  ) => Promise<PortfolioSnapshot | null>;
  updateAccountCuration: (
    args: UpdateAccountCurationArgs,
  ) => ReturnType<typeof updateAccountCuration>;
};

export function createD1HouseholdService(
  db: HouseholdServiceDb,
): HouseholdService {
  return {
    getAccountCurationSnapshot(householdId) {
      return getAccountCurationSnapshot(db, householdId);
    },

    getDashboardSnapshot(householdId) {
      return getDashboardSnapshot(db, householdId);
    },

    getHomepageSnapshot(householdId) {
      return getHomepageSnapshot(db, householdId);
    },

    getPortfolioSnapshot(householdId) {
      return getPortfolioSnapshot(db, householdId);
    },

    updateAccountCuration(args) {
      return updateAccountCuration(db, args);
    },
  };
}
