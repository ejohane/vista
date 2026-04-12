import type {
  DashboardSnapshot,
  FixtureSyncBatch,
  HomepageSnapshot,
  HouseholdStateExport,
  PortfolioSnapshot,
  UpdateAccountCurationArgs,
} from "@vista/db";

import {
  deserializeAccountCurationSnapshot,
  deserializeDashboardSnapshot,
  deserializeHomepageSnapshot,
  deserializeHouseholdStateExport,
  deserializePortfolioSnapshot,
  serializeHouseholdStateExport,
} from "./serde";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

async function expectJson(response: Response) {
  if (!response.ok) {
    throw new Error(await response.text());
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export function createHouseholdStateClient(args: { fetcher: FetchLike }) {
  const request = async (path: string, init?: RequestInit) => {
    const response = await args.fetcher(`https://household-state${path}`, init);
    return expectJson(response);
  };

  return {
    async getStatus(householdId: string) {
      return (await request(
        `/households/${encodeURIComponent(householdId)}/status`,
      )) as {
        accountCount: number;
        initialized: boolean;
        syncRunCount: number;
      };
    },

    async provisionHousehold(args: {
      createdAt?: Date;
      householdId: string;
      householdName: string;
      lastSyncedAt?: Date;
    }) {
      return request(
        `/households/${encodeURIComponent(args.householdId)}/provision`,
        {
          body: JSON.stringify({
            createdAt: args.createdAt?.toISOString() ?? null,
            householdName: args.householdName,
            lastSyncedAt: args.lastSyncedAt?.toISOString() ?? null,
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        },
      );
    },

    async importHouseholdState(
      householdId: string,
      snapshot: HouseholdStateExport,
    ) {
      return request(`/households/${encodeURIComponent(householdId)}/import`, {
        body: JSON.stringify(serializeHouseholdStateExport(snapshot)),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      });
    },

    async exportHouseholdState(householdId: string) {
      const response = (await request(
        `/households/${encodeURIComponent(householdId)}/export`,
      )) as ReturnType<typeof serializeHouseholdStateExport> | null;

      return response ? deserializeHouseholdStateExport(response) : null;
    },

    async getHomepageSnapshot(
      householdId: string,
    ): Promise<HomepageSnapshot | null> {
      return deserializeHomepageSnapshot(
        (await request(
          `/households/${encodeURIComponent(householdId)}/homepage-snapshot`,
        )) as ReturnType<typeof import("./serde").serializeHomepageSnapshot>,
      );
    },

    async getDashboardSnapshot(
      householdId: string,
    ): Promise<DashboardSnapshot | null> {
      return deserializeDashboardSnapshot(
        (await request(
          `/households/${encodeURIComponent(householdId)}/dashboard-snapshot`,
        )) as ReturnType<typeof import("./serde").serializeDashboardSnapshot>,
      );
    },

    async getPortfolioSnapshot(
      householdId: string,
    ): Promise<PortfolioSnapshot | null> {
      return deserializePortfolioSnapshot(
        (await request(
          `/households/${encodeURIComponent(householdId)}/portfolio-snapshot`,
        )) as ReturnType<typeof import("./serde").serializePortfolioSnapshot>,
      );
    },

    async getAccountCurationSnapshot(householdId: string) {
      return deserializeAccountCurationSnapshot(
        (await request(
          `/households/${encodeURIComponent(householdId)}/account-curation-snapshot`,
        )) as ReturnType<
          typeof import("./serde").serializeAccountCurationSnapshot
        >,
      );
    },

    async updateAccountCuration(args: UpdateAccountCurationArgs) {
      return request(
        `/households/${encodeURIComponent(args.householdId)}/account-curation`,
        {
          body: JSON.stringify({
            ...args,
            now: args.now?.toISOString() ?? null,
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        },
      ) as Promise<{ accountId: string; effectiveName: string }>;
    },

    async ingestFixtureSyncBatch(batch: FixtureSyncBatch) {
      return request(
        `/households/${encodeURIComponent(batch.householdId)}/fixture-sync`,
        {
          body: JSON.stringify({
            ...batch,
            balances: batch.balances.map((balance) => ({
              ...balance,
              capturedAt: balance.capturedAt.toISOString(),
            })),
            completedAt: batch.completedAt.toISOString(),
            startedAt: batch.startedAt.toISOString(),
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        },
      ) as Promise<{ completedAt: string; created: boolean; runId: string }>;
    },

    async createProviderConnection(args: {
      accessSecret?: null | string;
      accessToken?: null | string;
      accessUrl?: null | string;
      createdAt?: Date;
      externalConnectionId: string;
      householdId: string;
      id: string;
      institutionId?: null | string;
      institutionName?: null | string;
      plaidItemId?: null | string;
      provider: "plaid";
      status: "active" | "disconnected" | "error";
      updatedAt?: Date;
    }) {
      return request(
        `/households/${encodeURIComponent(args.householdId)}/provider-connections`,
        {
          body: JSON.stringify({
            ...args,
            createdAt: args.createdAt?.toISOString() ?? null,
            updatedAt: args.updatedAt?.toISOString() ?? null,
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        },
      ) as Promise<{ connectionId: string }>;
    },

    async syncPlaidConnection(args: {
      connectionId: string;
      householdId: string;
      now?: Date;
    }) {
      return request(
        `/households/${encodeURIComponent(args.householdId)}/provider-connections/${encodeURIComponent(args.connectionId)}/sync`,
        {
          body: JSON.stringify({
            now: args.now?.toISOString() ?? null,
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        },
      ) as Promise<{
        recordsChanged: number;
        runId: string;
        status: "succeeded";
      }>;
    },
  };
}
