import { asc, eq } from "drizzle-orm";

import type { VistaDb } from "./client";
import { households } from "./schema";

type HouseholdAccessDb = Pick<VistaDb, "query" | "select">;

export type HouseholdSummary = {
  id: string;
  lastSyncedAt: Date;
  name: string;
};

export type HouseholdAccess = {
  getHousehold: (householdId: string) => Promise<HouseholdSummary | null>;
  listHouseholds: () => Promise<HouseholdSummary[]>;
};

export function createD1HouseholdAccess(
  db: HouseholdAccessDb,
): HouseholdAccess {
  return {
    async getHousehold(householdId) {
      const household = await db.query.households.findFirst({
        where: eq(households.id, householdId),
      });

      if (!household) {
        return null;
      }

      return {
        id: household.id,
        lastSyncedAt: household.lastSyncedAt,
        name: household.name,
      };
    },

    async listHouseholds() {
      return db
        .select({
          id: households.id,
          lastSyncedAt: households.lastSyncedAt,
          name: households.name,
        })
        .from(households)
        .orderBy(asc(households.createdAt));
    },
  };
}

export async function resolveHouseholdSelection(
  access: HouseholdAccess,
  requestedHouseholdId: null | string,
): Promise<HouseholdSummary | null> {
  if (requestedHouseholdId) {
    const household = await access.getHousehold(requestedHouseholdId);

    if (!household) {
      throw new Error(`Household ${requestedHouseholdId} could not be found.`);
    }

    return household;
  }

  const households = await access.listHouseholds();

  if (households.length === 0) {
    return null;
  }

  if (households.length === 1) {
    return households[0] ?? null;
  }

  throw new Error(
    "Multiple households are available. Pass householdId explicitly.",
  );
}
