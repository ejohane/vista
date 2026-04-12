import type { FixtureSyncBatch } from "@vista/db";
import {
  createDurableObjectSqliteD1Database,
  createHouseholdStateStore,
  deserializeHouseholdStateExport,
  serializeAccountCurationSnapshot,
  serializeDashboardSnapshot,
  serializeHomepageSnapshot,
  serializeHouseholdStateExport,
  serializePortfolioSnapshot,
} from "@vista/household-state";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
    },
    status,
  });
}

function readIsoDate(value: null | string | undefined) {
  return value ? new Date(value) : undefined;
}

function readOptionalEnvString(
  env: Env,
  key: "PLAID_CLIENT_ID" | "PLAID_ENV" | "PLAID_SECRET",
) {
  const value = (env as Env & Record<string, unknown>)[key];

  return typeof value === "string" && value.trim() ? value : undefined;
}

export class HouseholdState {
  private readonly database: D1Database & { sync?: () => Promise<void> };
  private readonly env: Env;
  private readonly store: ReturnType<typeof createHouseholdStateStore>;

  constructor(ctx: DurableObjectState, env: Env) {
    this.env = env;
    this.database = createDurableObjectSqliteD1Database(ctx.storage);
    this.store = createHouseholdStateStore(this.database);
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const householdId = segments[1];
    const route = `/${segments.slice(2).join("/")}`;

    if (!householdId) {
      return new Response("Household id is required.", { status: 400 });
    }

    if (route === "/status" && request.method === "GET") {
      const snapshot = await this.store.exportHouseholdState(householdId);

      return jsonResponse({
        accountCount: snapshot?.accounts.length ?? 0,
        initialized: snapshot !== null,
        syncRunCount: snapshot?.syncRuns.length ?? 0,
      });
    }

    if (route === "/provision" && request.method === "POST") {
      const body = (await request.json()) as {
        createdAt: null | string;
        householdName: string;
        lastSyncedAt: null | string;
      };
      const result = await this.store.provisionHousehold({
        createdAt: readIsoDate(body.createdAt),
        householdId,
        householdName: body.householdName,
        lastSyncedAt: readIsoDate(body.lastSyncedAt),
      });

      await this.database.sync?.();
      return jsonResponse(result, 201);
    }

    if (route === "/import" && request.method === "POST") {
      const body = (await request.json()) as ReturnType<
        typeof serializeHouseholdStateExport
      >;
      await this.store.importHouseholdState(
        deserializeHouseholdStateExport(body),
      );

      await this.database.sync?.();
      return new Response(null, { status: 204 });
    }

    if (route === "/export" && request.method === "GET") {
      const snapshot = await this.store.exportHouseholdState(householdId);

      return jsonResponse(
        snapshot ? serializeHouseholdStateExport(snapshot) : null,
      );
    }

    if (route === "/homepage-snapshot" && request.method === "GET") {
      return jsonResponse(
        serializeHomepageSnapshot(
          await this.store.getHomepageSnapshot(householdId),
        ),
      );
    }

    if (route === "/dashboard-snapshot" && request.method === "GET") {
      return jsonResponse(
        serializeDashboardSnapshot(
          await this.store.getDashboardSnapshot(householdId),
        ),
      );
    }

    if (route === "/portfolio-snapshot" && request.method === "GET") {
      return jsonResponse(
        serializePortfolioSnapshot(
          await this.store.getPortfolioSnapshot(householdId),
        ),
      );
    }

    if (route === "/account-curation-snapshot" && request.method === "GET") {
      return jsonResponse(
        serializeAccountCurationSnapshot(
          await this.store.getAccountCurationSnapshot(householdId),
        ),
      );
    }

    if (route === "/account-curation" && request.method === "POST") {
      const body = (await request.json()) as Omit<
        Parameters<typeof this.store.updateAccountCuration>[0],
        "householdId"
      > & {
        now: null | string;
      };
      const result = await this.store.updateAccountCuration({
        ...body,
        householdId,
        now: readIsoDate(body.now),
      });

      await this.database.sync?.();
      return jsonResponse(result);
    }

    if (route === "/fixture-sync" && request.method === "POST") {
      const body = (await request.json()) as Omit<
        FixtureSyncBatch,
        "completedAt" | "startedAt" | "balances"
      > & {
        balances: Array<
          FixtureSyncBatch["balances"][number] & { capturedAt: string }
        >;
        completedAt: string;
        startedAt: string;
      };
      const result = await this.store.ingestFixtureSyncBatch({
        ...body,
        balances: body.balances.map((balance) => ({
          ...balance,
          capturedAt: new Date(balance.capturedAt),
        })),
        completedAt: new Date(body.completedAt),
        householdId,
        startedAt: new Date(body.startedAt),
      });

      await this.database.sync?.();
      return jsonResponse({
        ...result,
        completedAt: result.completedAt.toISOString(),
      });
    }

    if (route === "/provider-connections" && request.method === "POST") {
      const body = (await request.json()) as {
        accessSecret?: null | string;
        accessToken?: null | string;
        accessUrl?: null | string;
        createdAt?: null | string;
        externalConnectionId: string;
        id: string;
        institutionId?: null | string;
        institutionName?: null | string;
        plaidItemId?: null | string;
        provider: "plaid";
        status: "active" | "disconnected" | "error";
        updatedAt?: null | string;
      };
      const result = await this.store.createProviderConnection({
        ...body,
        createdAt: readIsoDate(body.createdAt),
        householdId,
        updatedAt: readIsoDate(body.updatedAt),
      });

      await this.database.sync?.();
      return jsonResponse(result, 201);
    }

    if (
      route.startsWith("/provider-connections/") &&
      route.endsWith("/sync") &&
      request.method === "POST"
    ) {
      const connectionId = segments[3];

      if (!connectionId) {
        return new Response("Connection id is required.", { status: 400 });
      }

      const body = (await request.json()) as {
        now: null | string;
      };
      const result = await this.store.syncPlaidConnection({
        clientId: readOptionalEnvString(this.env, "PLAID_CLIENT_ID"),
        connectionId,
        environment: readOptionalEnvString(this.env, "PLAID_ENV") as
          | "development"
          | "production"
          | "sandbox"
          | undefined,
        now: readIsoDate(body.now),
        secret: readOptionalEnvString(this.env, "PLAID_SECRET"),
      });

      await this.database.sync?.();
      return jsonResponse(result);
    }

    return new Response("Not found.", { status: 404 });
  }
}
