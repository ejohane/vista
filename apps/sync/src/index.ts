import { getDashboardSnapshot, getDb } from "@vista/db";

import { ingestDemoSyncBatch } from "./fixture-sync";

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
        : "Run bun run db:seed:local to load the demo household before exercising the sync worker locally.",
      status: ready ? "ready" : "waiting_for_seed",
      syncedHousehold: ready ? (snapshot?.householdName ?? null) : null,
    });
  },

  async scheduled(event, env) {
    const ingestResult = await ingestDemoSyncBatch(env.DB);
    const snapshot = await readSnapshot(env);

    console.log(
      JSON.stringify({
        createdRun: ingestResult.created,
        cron: event.cron,
        household: snapshot?.householdName ?? null,
        lastSyncedAt: snapshot?.lastSyncedAt.toISOString() ?? null,
        netWorthMinor: snapshot?.totals.netWorthMinor ?? null,
        runId: ingestResult.runId,
      }),
    );
  },
} satisfies ExportedHandler<Env>;
