import { getDashboardSnapshot, getDb } from "@vista/db";

import { ingestDemoSyncBatch } from "./fixture-sync";
import { syncConfiguredPlaidConnections } from "./plaid-sync";

function readOptionalEnvString(
  env: Env,
  key: "PLAID_CLIENT_ID" | "PLAID_ENV" | "PLAID_SECRET",
) {
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
      secret: readOptionalEnvString(env, "PLAID_SECRET"),
    });
    const syncResults = [...plaidResults];
    const ingestResult =
      !hasConfiguredConnections && hasSeedData && syncResults.length === 0
        ? await ingestDemoSyncBatch(env.DB)
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

    console.log(JSON.stringify(logPayload));
  },
} satisfies ExportedHandler<Env>;
