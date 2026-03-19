import type { FixtureSyncBatch } from "@vista/db";

export const demoSyncBatch: FixtureSyncBatch = {
  balances: [
    {
      accountId: "acct_checking",
      asOfDate: "2026-03-17",
      balanceMinor: 1102300,
      capturedAt: new Date("2026-03-17T18:30:00.000Z"),
      id: "snapshot_sync_demo_2026_03_17_acct_checking",
    },
    {
      accountId: "acct_savings",
      asOfDate: "2026-03-17",
      balanceMinor: 3880100,
      capturedAt: new Date("2026-03-17T18:30:00.000Z"),
      id: "snapshot_sync_demo_2026_03_17_acct_savings",
    },
    {
      accountId: "acct_brokerage",
      asOfDate: "2026-03-17",
      balanceMinor: 16910450,
      capturedAt: new Date("2026-03-17T18:30:00.000Z"),
      id: "snapshot_sync_demo_2026_03_17_acct_brokerage",
    },
    {
      accountId: "acct_retirement",
      asOfDate: "2026-03-17",
      balanceMinor: 24150000,
      capturedAt: new Date("2026-03-17T18:30:00.000Z"),
      id: "snapshot_sync_demo_2026_03_17_acct_retirement",
    },
  ],
  completedAt: new Date("2026-03-17T18:30:00.000Z"),
  householdId: "household_demo",
  runId: "sync_demo_2026_03_17",
  startedAt: new Date("2026-03-17T18:25:00.000Z"),
  trigger: "scheduled",
};

type IngestFixtureSyncResult = {
  completedAt: Date;
  created: boolean;
  runId: string;
};

type ExistingSyncRun = {
  completedAt: number | null;
  status: "failed" | "running" | "succeeded";
};

function getChangedRowCount(result: {
  meta?: {
    changes?: number;
  };
}) {
  return result.meta?.changes ?? 0;
}

async function readExistingRun(database: D1Database, runId: string) {
  return database
    .prepare(
      `
        select status, completed_at as completedAt
        from sync_runs
        where id = ?
      `,
    )
    .bind(runId)
    .first<ExistingSyncRun>();
}

async function validateFixtureBatch(
  database: D1Database,
  batch: FixtureSyncBatch,
) {
  const household = await database
    .prepare(
      `
        select id
        from households
        where id = ?
      `,
    )
    .bind(batch.householdId)
    .first<{ id: string }>();

  if (!household) {
    throw new Error(
      `Fixture sync batch ${batch.runId} references missing household ${batch.householdId}.`,
    );
  }

  const accountIds = [
    ...new Set(batch.balances.map((balance) => balance.accountId)),
  ];

  if (accountIds.length === 0) {
    throw new Error(
      `Fixture sync batch ${batch.runId} does not include balances.`,
    );
  }

  const placeholders = accountIds.map(() => "?").join(", ");
  const matchingAccounts = await database
    .prepare(
      `
        select id
        from accounts
        where household_id = ?
          and id in (${placeholders})
      `,
    )
    .bind(batch.householdId, ...accountIds)
    .all<{ id: string }>();
  const matchingAccountIds = new Set(
    matchingAccounts.results.map((account) => account.id),
  );
  const invalidAccountIds = accountIds.filter(
    (accountId) => !matchingAccountIds.has(accountId),
  );

  if (invalidAccountIds.length > 0) {
    throw new Error(
      `Fixture sync batch ${batch.runId} references accounts outside household ${batch.householdId}: ${invalidAccountIds.join(", ")}.`,
    );
  }
}

async function claimFixtureRun(database: D1Database, batch: FixtureSyncBatch) {
  const insertedRun = await database
    .prepare(
      `
        insert or ignore into sync_runs (
          id,
          household_id,
          status,
          trigger,
          started_at,
          completed_at
        )
        values (?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      batch.runId,
      batch.householdId,
      "running",
      batch.trigger,
      batch.startedAt.getTime(),
      null,
    )
    .run();

  if (getChangedRowCount(insertedRun) > 0) {
    return "claimed";
  }

  const existingRun = await readExistingRun(database, batch.runId);

  if (!existingRun) {
    throw new Error(`Fixture sync run ${batch.runId} could not be claimed.`);
  }

  if (existingRun.status === "succeeded") {
    return "existing";
  }

  if (existingRun.status === "failed") {
    const reclaimedRun = await database
      .prepare(
        `
          update sync_runs
          set status = ?, trigger = ?, started_at = ?, completed_at = ?
          where id = ? and status = ?
        `,
      )
      .bind(
        "running",
        batch.trigger,
        batch.startedAt.getTime(),
        null,
        batch.runId,
        "failed",
      )
      .run();

    if (getChangedRowCount(reclaimedRun) > 0) {
      return "claimed";
    }
  }

  return "existing";
}

async function markRunFailed(
  database: D1Database,
  batch: FixtureSyncBatch,
  failedAt: Date,
) {
  await database
    .prepare(
      `
        update sync_runs
        set status = ?, completed_at = ?
        where id = ?
      `,
    )
    .bind("failed", failedAt.getTime(), batch.runId)
    .run();
}

export async function ingestFixtureSyncBatch(
  database: D1Database,
  batch: FixtureSyncBatch,
): Promise<IngestFixtureSyncResult> {
  const claimStatus = await claimFixtureRun(database, batch);

  if (claimStatus === "existing") {
    return {
      completedAt: batch.completedAt,
      created: false,
      runId: batch.runId,
    };
  }

  const completionTime = batch.completedAt.getTime();

  try {
    await validateFixtureBatch(database, batch);

    await database.batch([
      ...batch.balances.map((balance) =>
        database
          .prepare(
            `
              insert into balance_snapshots (
                id,
                account_id,
                source_sync_run_id,
                captured_at,
                as_of_date,
                balance_minor
              )
              values (?, ?, ?, ?, ?, ?)
            `,
          )
          .bind(
            balance.id,
            balance.accountId,
            batch.runId,
            balance.capturedAt.getTime(),
            balance.asOfDate,
            balance.balanceMinor,
          ),
      ),
      ...batch.balances.map((balance) =>
        database
          .prepare(
            `
              update accounts
              set balance_minor = ?, updated_at = ?
              where id = ?
            `,
          )
          .bind(balance.balanceMinor, completionTime, balance.accountId),
      ),
      database
        .prepare(
          `
            update sync_runs
            set status = ?, completed_at = ?
            where id = ?
          `,
        )
        .bind("succeeded", completionTime, batch.runId),
      database
        .prepare(
          `
            update households
            set last_synced_at = ?
            where id = ?
          `,
        )
        .bind(completionTime, batch.householdId),
    ]);
  } catch (error) {
    await markRunFailed(database, batch, new Date(completionTime));
    throw error;
  }

  return {
    completedAt: batch.completedAt,
    created: true,
    runId: batch.runId,
  };
}

export function ingestDemoSyncBatch(database: D1Database) {
  return ingestFixtureSyncBatch(database, demoSyncBatch);
}
