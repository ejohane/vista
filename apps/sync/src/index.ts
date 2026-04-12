import { getDashboardSnapshot, getDb } from "@vista/db";

import {
  createAlphaVantagePriceClient,
  refreshHistoricalNetWorthForRunIds,
} from "./backfilled-net-worth";
import { ingestDemoSyncBatch } from "./fixture-sync";
import { syncConfiguredPlaidConnections } from "./plaid-sync";

function readOptionalEnvString(env: Env, key: string) {
  const value = (env as Env & Record<string, unknown>)[key];

  return typeof value === "string" && value.trim() ? value : undefined;
}

async function readSnapshot(env: Env) {
  const db = getDb(env.DB);
  return getDashboardSnapshot(db);
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
        and access_token is not null
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    url.pathname = "/__scheduled";
    url.searchParams.set("cron", "0 13 * * *");

    const snapshot = await readSnapshot(env);
    const ready = await hasSuccessfulSync(env);

    return Response.json({
      nextStep: snapshot
        ? `Run curl "${url.href}" to exercise the scheduled handler locally.`
        : "Connect a Plaid account to start syncing, or run bun run db:seed:local if you want demo data locally.",
      status: ready ? "ready" : "waiting_for_seed",
      syncedHousehold: ready ? (snapshot?.householdName ?? null) : null,
    });
  },

  async scheduled(event, env) {
    const now = new Date();
    const hasConfiguredConnections = await hasConfiguredProviderConnection(env);
    const hasSeedData = await hasLocalSeedData(env);
    const plaidResults = await syncConfiguredPlaidConnections({
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
        ? await ingestDemoSyncBatch(env.DB)
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
