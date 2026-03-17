import { getDashboardSnapshot, getDb } from "@vista/db";

async function readSnapshot(env: Env) {
  const db = getDb(env.DB);
  return getDashboardSnapshot(db);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    url.pathname = "/__scheduled";
    url.searchParams.set("cron", "0 13 * * *");

    const snapshot = await readSnapshot(env);

    return Response.json({
      nextStep: `Run curl "${url.href}" to exercise the scheduled handler locally.`,
      status: snapshot ? "ready" : "waiting_for_seed",
      syncedHousehold: snapshot?.householdName ?? null,
    });
  },

  async scheduled(event, env) {
    const snapshot = await readSnapshot(env);

    console.log(
      JSON.stringify({
        cron: event.cron,
        household: snapshot?.householdName ?? null,
        lastSyncedAt: snapshot?.lastSyncedAt.toISOString() ?? null,
        netWorthMinor: snapshot?.totals.netWorthMinor ?? null,
      }),
    );
  },
} satisfies ExportedHandler<Env>;
