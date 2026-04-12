import {
  createD1HouseholdAccess,
  getDb,
  resolveHouseholdSelection,
} from "@vista/db";
import {
  createHouseholdStateClientFromEnv,
  createRuntimeHouseholdService,
  ensureHouseholdStateHydrated,
  readHouseholdStateMode,
} from "@vista/household-state";

import {
  createAlphaVantagePriceClient,
  refreshHistoricalNetWorthForRunIds,
} from "./backfilled-net-worth";
import { demoSyncBatch, ingestDemoSyncBatch } from "./fixture-sync";
import { syncConfiguredPlaidConnections } from "./plaid-sync";

function readOptionalEnvString(env: Env, key: string) {
  const value = (env as Env & Record<string, unknown>)[key];

  return typeof value === "string" && value.trim() ? value : undefined;
}

async function readSnapshot(env: Env) {
  const db = getDb(env.DB);
  const householdStateEnv = env as Env & Record<string, unknown>;
  const householdService = createRuntimeHouseholdService({
    client: createHouseholdStateClientFromEnv(householdStateEnv),
    database: env.DB,
    mode: readHouseholdStateMode(householdStateEnv),
    onParityMismatch(args) {
      console.warn("Sync household state parity mismatch.", args);
    },
  });

  try {
    const household = await resolveHouseholdSelection(
      createD1HouseholdAccess(db),
      null,
    );

    if (!household) {
      return null;
    }

    return householdService.getDashboardSnapshot(household.id);
  } catch {
    return null;
  }
}

async function hasSuccessfulSync(env: Env) {
  const successfulRun = await env.DB.prepare(
    `
        select id
        from sync_runs
        where status = ? and completed_at is not null
        limit 1
      `,
  )
    .bind("succeeded")
    .first<{ id: string }>();

  return successfulRun !== null;
}

async function hasConfiguredProviderConnection(env: Env) {
  const configuredConnection = await env.DB.prepare(
    `
      select id
      from provider_connections
      where status = ?
        and provider = ?
      limit 1
    `,
  )
    .bind("active", "plaid")
    .first<{ id: string }>();

  return configuredConnection !== null;
}

async function hasLocalSeedData(env: Env) {
  const seededRows = await env.DB.prepare(
    `
      select
        (select count(*) from households) as householdCount,
        (select count(*) from accounts) as accountCount
    `,
  ).first<{
    accountCount: number;
    householdCount: number;
  }>();

  return (
    Number(seededRows?.householdCount ?? 0) > 0 &&
    Number(seededRows?.accountCount ?? 0) > 0
  );
}

async function listActivePlaidConnections(database: D1Database) {
  const result = await database
    .prepare(
      `
        select id, household_id as householdId
        from provider_connections
        where provider = ?
          and status = ?
      `,
    )
    .bind("plaid", "active")
    .all<{
      householdId: string;
      id: string;
    }>();

  return result.results;
}

async function syncStateBackedPlaidConnections(env: Env, now?: Date) {
  const client = createHouseholdStateClientFromEnv(
    env as Env & Record<string, unknown>,
  );

  if (!client) {
    return [];
  }

  const connections = await listActivePlaidConnections(env.DB);
  const results = [];

  for (const connection of connections) {
    try {
      await ensureHouseholdStateHydrated({
        client,
        database: env.DB,
        householdId: connection.householdId,
      });
      results.push(
        await client.syncPlaidConnection({
          connectionId: connection.id,
          householdId: connection.householdId,
          now,
        }),
      );
    } catch (error) {
      console.error("State-backed Plaid sync failed.", {
        connectionId: connection.id,
        error: error instanceof Error ? error.message : String(error),
        householdId: connection.householdId,
      });
    }
  }

  return results;
}

async function ingestStateFixtureIfNeeded(env: Env) {
  const client = createHouseholdStateClientFromEnv(
    env as Env & Record<string, unknown>,
  );

  if (!client) {
    return null;
  }

  await ensureHouseholdStateHydrated({
    client,
    database: env.DB,
    householdId: "household_demo",
  });

  return client.ingestFixtureSyncBatch({
    ...demoSyncBatch,
  });
}

async function ingestDualFixtureIfNeeded(env: Env) {
  await ingestDemoSyncBatch(env.DB);
  return ingestStateFixtureIfNeeded(env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    url.pathname = "/__scheduled";
    url.searchParams.set("cron", "0 13 * * *");

    const snapshot = await readSnapshot(env);
    const ready =
      Boolean(snapshot?.hasSuccessfulSync) || (await hasSuccessfulSync(env));

    return Response.json({
      nextStep: snapshot
        ? `Run curl "${url.href}" to exercise the scheduled handler locally.`
        : ready
          ? "Pass householdId in the request URL to inspect a specific household."
          : "Connect a Plaid account to start syncing, or run bun run db:seed:local if you want demo data locally.",
      status:
        ready && snapshot
          ? "ready"
          : ready
            ? "household_selection_required"
            : "waiting_for_seed",
      syncedHousehold: ready ? (snapshot?.householdName ?? null) : null,
    });
  },

  async scheduled(event, env) {
    const now = new Date();
    const mode = readHouseholdStateMode(env as Env & Record<string, unknown>);
    const hasConfiguredConnections = await hasConfiguredProviderConnection(env);
    const hasSeedData = await hasLocalSeedData(env);
    const plaidResults =
      mode === "state"
        ? await syncStateBackedPlaidConnections(env, now)
        : mode === "dual"
          ? [
              ...(await syncConfiguredPlaidConnections({
                clientId: readOptionalEnvString(env, "PLAID_CLIENT_ID"),
                database: env.DB,
                environment:
                  (readOptionalEnvString(env, "PLAID_ENV") as
                    | "development"
                    | "production"
                    | "sandbox"
                    | undefined) ?? undefined,
                now,
                secret: readOptionalEnvString(env, "PLAID_SECRET"),
              })),
              ...(await syncStateBackedPlaidConnections(env, now)),
            ]
          : await syncConfiguredPlaidConnections({
              clientId: readOptionalEnvString(env, "PLAID_CLIENT_ID"),
              database: env.DB,
              environment:
                (readOptionalEnvString(env, "PLAID_ENV") as
                  | "development"
                  | "production"
                  | "sandbox"
                  | undefined) ?? undefined,
              now,
              secret: readOptionalEnvString(env, "PLAID_SECRET"),
            });
    const syncResults = [...plaidResults];
    const ingestResult =
      !hasConfiguredConnections && hasSeedData && syncResults.length === 0
        ? mode === "state"
          ? await ingestStateFixtureIfNeeded(env)
          : mode === "dual"
            ? await ingestDualFixtureIfNeeded(env)
            : await ingestDemoSyncBatch(env.DB)
        : null;
    const alphaVantageApiKey = readOptionalEnvString(
      env,
      "ALPHA_VANTAGE_API_KEY",
    );
    const runIds = [
      ...syncResults.map((result) => result.runId),
      ...(ingestResult ? [ingestResult.runId] : []),
    ];
    const backfillResult =
      runIds.length > 0
        ? await refreshHistoricalNetWorthForRunIds({
            database: env.DB,
            now,
            priceClient: alphaVantageApiKey
              ? createAlphaVantagePriceClient({ apiKey: alphaVantageApiKey })
              : undefined,
            runIds,
          })
        : null;
    const snapshot = await readSnapshot(env);
    const logPayload = ingestResult
      ? {
          createdRun: ingestResult.created,
          cron: event.cron,
          household: snapshot?.householdName ?? null,
          lastSyncedAt: snapshot?.lastSyncedAt.toISOString() ?? null,
          netWorthMinor: snapshot?.totals.netWorthMinor ?? null,
          runId: ingestResult.runId,
        }
      : {
          cron: event.cron,
          household: snapshot?.householdName ?? null,
          lastSyncedAt: snapshot?.lastSyncedAt.toISOString() ?? null,
          netWorthMinor: snapshot?.totals.netWorthMinor ?? null,
          runId: syncResults[0]?.runId ?? null,
          awaitingInitialConnection:
            !hasConfiguredConnections &&
            !hasSeedData &&
            syncResults.length === 0,
          syncedConnections: syncResults.length,
          usedFixtureData: false,
        };

    if (backfillResult && backfillResult.rebuiltHouseholdCount > 0) {
      Object.assign(logPayload, {
        backfilledHouseholds: backfillResult.rebuiltHouseholdCount,
        importedPrices: backfillResult.importedPriceCount,
        missingPrices: backfillResult.missingPriceCount,
        rebuiltNetWorthFacts: backfillResult.netWorthFactCount,
      });
    }

    console.log(JSON.stringify(logPayload));
  },
} satisfies ExportedHandler<Env>;
