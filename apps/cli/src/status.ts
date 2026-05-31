import type { LocalD1Database } from "./local-d1";

const DEFAULT_SYNC_RUN_LIMIT = 20;
const MAX_SYNC_RUN_LIMIT = 100;
const STALE_SYNC_THRESHOLD_MS = 24 * 60 * 60 * 1000;

type StatusSummaryRow = {
  accountCount: number;
  activeConnectionCount: number;
  bankTransactionCount: number;
  connectionCount: number;
  holdingCount: number;
  investmentTransactionCount: number;
};

type LatestSyncRunRow = {
  completedAt: null | number;
  connectionId: null | string;
  errorSummary: null | string;
  institutionName: null | string;
  provider: null | string;
  recordsChanged: number;
  runId: string;
  startedAt: number;
  status: SyncRunStatus;
};

type ConnectionHealthRow = {
  connectionId: string;
  institutionName: null | string;
  latestCompletedAt: null | number;
  latestErrorSummary: null | string;
  latestStartedAt: null | number;
  latestStatus: null | SyncRunStatus;
  lastSuccessfulSyncAt: null | number;
  provider: "coinbase" | "plaid";
  status: string;
};

type ConnectionHealthState = "inactive" | "never_synced" | "ok" | "stale";
type SyncRunStatus = "failed" | "running" | "succeeded";

export type VistaStatusSummary = {
  activeConnectionCount: number;
  connectionCount: number;
  connections: Array<
    ConnectionHealthRow & {
      state: ConnectionHealthState;
    }
  >;
  lastFailedSync: LatestSyncRunRow | null;
  lastSuccessfulSync: LatestSyncRunRow | null;
  latestSync: LatestSyncRunRow | null;
  neverSyncedActiveConnectionCount: number;
  recordCounts: {
    accounts: number;
    bankTransactions: number;
    holdings: number;
    investmentTransactions: number;
  };
  staleActiveConnectionCount: number;
};

export type SyncRunListOptions = {
  limit: number;
};

export type SyncRunRow = {
  completedAt: null | number;
  connectionId: null | string;
  errorSummary: null | string;
  institutionName: null | string;
  provider: string;
  recordsChanged: number;
  runId: string;
  startedAt: number;
  status: SyncRunStatus;
  trigger: string;
};

function formatDateTime(timestamp: null | number) {
  if (timestamp === null) {
    return "never";
  }

  return new Date(timestamp).toISOString().replace(".000Z", "Z");
}

function formatProvider(provider: null | string) {
  if (!provider) {
    return "unknown";
  }

  return provider;
}

function formatConnection(row: {
  connectionId: null | string;
  institutionName: null | string;
  provider: null | string;
}) {
  return (
    row.institutionName?.trim() ||
    row.connectionId?.trim() ||
    formatProvider(row.provider)
  );
}

function formatRunSummary(run: LatestSyncRunRow | null) {
  if (!run) {
    return "never";
  }

  const completedAt = formatDateTime(run.completedAt ?? run.startedAt);
  const provider = formatProvider(run.provider);

  return `${run.status} (${provider}) at ${completedAt}`;
}

function pad(value: string, length: number) {
  return value.padEnd(length, " ");
}

function truncate(value: string, length: number) {
  if (value.length <= length) {
    return value;
  }

  return value.slice(0, length - 1);
}

export function parseSyncRunsArgs(argv: string[]): SyncRunListOptions {
  const options: SyncRunListOptions = {
    limit: DEFAULT_SYNC_RUN_LIMIT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--limit") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("--limit requires a value.");
      }

      const limit = Number(value);

      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SYNC_RUN_LIMIT) {
        throw new Error(
          `Sync runs limit must be an integer between 1 and ${MAX_SYNC_RUN_LIMIT}.`,
        );
      }

      options.limit = limit;
      index += 1;
      continue;
    }

    throw new Error(`Unknown sync runs option: ${arg}`);
  }

  return options;
}

export function parseSyncShowArgs(argv: string[]) {
  const [runId, unexpectedArg] = argv;

  if (!runId) {
    throw new Error("sync show requires a run id.");
  }

  if (unexpectedArg) {
    throw new Error(`Unknown sync show option: ${unexpectedArg}`);
  }

  return {
    runId,
  };
}

async function getLatestSyncRun(
  database: LocalD1Database,
  status?: SyncRunStatus,
) {
  const whereStatus = status ? "where sr.status = ?" : "";
  const statement = database.prepare(
    `
      select
        sr.id as runId,
        sr.provider_connection_id as connectionId,
        coalesce(sr.provider, pc.provider) as provider,
        pc.institution_name as institutionName,
        sr.status,
        sr.started_at as startedAt,
        sr.completed_at as completedAt,
        sr.records_changed as recordsChanged,
        sr.error_summary as errorSummary
      from sync_runs sr
      left join provider_connections pc on pc.id = sr.provider_connection_id
      ${whereStatus}
      order by coalesce(sr.completed_at, sr.started_at) desc, sr.started_at desc
      limit 1
    `,
  );

  return status
    ? statement.bind(status).first<LatestSyncRunRow>()
    : statement.first<LatestSyncRunRow>();
}

async function listConnectionHealthRows(database: LocalD1Database) {
  const rows = await database
    .prepare(
      `
        select
          pc.id as connectionId,
          pc.provider,
          pc.institution_name as institutionName,
          pc.status,
          (
            select sr.status
            from sync_runs sr
            where sr.provider_connection_id = pc.id
            order by coalesce(sr.completed_at, sr.started_at) desc, sr.started_at desc
            limit 1
          ) as latestStatus,
          (
            select sr.started_at
            from sync_runs sr
            where sr.provider_connection_id = pc.id
            order by coalesce(sr.completed_at, sr.started_at) desc, sr.started_at desc
            limit 1
          ) as latestStartedAt,
          (
            select sr.completed_at
            from sync_runs sr
            where sr.provider_connection_id = pc.id
            order by coalesce(sr.completed_at, sr.started_at) desc, sr.started_at desc
            limit 1
          ) as latestCompletedAt,
          (
            select sr.error_summary
            from sync_runs sr
            where sr.provider_connection_id = pc.id
            order by coalesce(sr.completed_at, sr.started_at) desc, sr.started_at desc
            limit 1
          ) as latestErrorSummary,
          (
            select max(sr.completed_at)
            from sync_runs sr
            where sr.provider_connection_id = pc.id
              and sr.status = 'succeeded'
              and sr.completed_at is not null
          ) as lastSuccessfulSyncAt
        from provider_connections pc
        order by pc.provider asc, pc.institution_name asc, pc.id asc
      `,
    )
    .all<ConnectionHealthRow>();

  return rows.results;
}

export async function getVistaStatusSummary(
  database: LocalD1Database,
  now = new Date(),
): Promise<VistaStatusSummary> {
  const summary = await database
    .prepare(
      `
        select
          (select count(*) from provider_connections) as connectionCount,
          (select count(*) from provider_connections where status = 'active') as activeConnectionCount,
          (select count(*) from accounts) as accountCount,
          (select count(*) from holdings) as holdingCount,
          (select count(*) from transactions) as bankTransactionCount,
          (select count(*) from investment_transactions) as investmentTransactionCount
      `,
    )
    .first<StatusSummaryRow>();
  const latestSync = await getLatestSyncRun(database);
  const lastSuccessfulSync = await getLatestSyncRun(database, "succeeded");
  const lastFailedSync = await getLatestSyncRun(database, "failed");
  const connections = await listConnectionHealthRows(database);
  const staleBefore = now.getTime() - STALE_SYNC_THRESHOLD_MS;
  const enrichedConnections = connections.map((connection) => {
    const isActive = connection.status === "active";
    const state: ConnectionHealthState = !isActive
      ? "inactive"
      : connection.lastSuccessfulSyncAt === null
        ? "never_synced"
        : connection.lastSuccessfulSyncAt < staleBefore
          ? "stale"
          : "ok";

    return {
      ...connection,
      state,
    };
  });

  return {
    activeConnectionCount: Number(summary?.activeConnectionCount ?? 0),
    connectionCount: Number(summary?.connectionCount ?? 0),
    connections: enrichedConnections,
    lastFailedSync,
    lastSuccessfulSync,
    latestSync,
    neverSyncedActiveConnectionCount: enrichedConnections.filter(
      (connection) => connection.state === "never_synced",
    ).length,
    recordCounts: {
      accounts: Number(summary?.accountCount ?? 0),
      bankTransactions: Number(summary?.bankTransactionCount ?? 0),
      holdings: Number(summary?.holdingCount ?? 0),
      investmentTransactions: Number(summary?.investmentTransactionCount ?? 0),
    },
    staleActiveConnectionCount: enrichedConnections.filter(
      (connection) => connection.state === "stale",
    ).length,
  };
}

export async function listSyncRuns(
  database: LocalD1Database,
  options: SyncRunListOptions,
) {
  const rows = await database
    .prepare(
      `
        select
          sr.id as runId,
          sr.provider_connection_id as connectionId,
          coalesce(sr.provider, pc.provider, 'unknown') as provider,
          pc.institution_name as institutionName,
          sr.status,
          sr.trigger,
          sr.started_at as startedAt,
          sr.completed_at as completedAt,
          sr.records_changed as recordsChanged,
          sr.error_summary as errorSummary
        from sync_runs sr
        left join provider_connections pc on pc.id = sr.provider_connection_id
        order by coalesce(sr.completed_at, sr.started_at) desc, sr.started_at desc
        limit ?
      `,
    )
    .bind(options.limit)
    .all<SyncRunRow>();

  return rows.results;
}

export async function getSyncRun(database: LocalD1Database, runId: string) {
  const row = await database
    .prepare(
      `
        select
          sr.id as runId,
          sr.provider_connection_id as connectionId,
          coalesce(sr.provider, pc.provider, 'unknown') as provider,
          pc.institution_name as institutionName,
          sr.status,
          sr.trigger,
          sr.started_at as startedAt,
          sr.completed_at as completedAt,
          sr.records_changed as recordsChanged,
          sr.error_summary as errorSummary
        from sync_runs sr
        left join provider_connections pc on pc.id = sr.provider_connection_id
        where sr.id = ?
      `,
    )
    .bind(runId)
    .first<SyncRunRow>();

  if (!row) {
    throw new Error(`Sync run not found: ${runId}`);
  }

  return row;
}

export function printStatus(summary: VistaStatusSummary) {
  console.log("Vista Status");
  console.log(
    `Connections: ${summary.activeConnectionCount} active / ${summary.connectionCount} total`,
  );
  console.log(`Latest sync: ${formatRunSummary(summary.latestSync)}`);
  console.log(
    `Last successful sync: ${formatRunSummary(summary.lastSuccessfulSync)}`,
  );
  console.log(`Last failed sync: ${formatRunSummary(summary.lastFailedSync)}`);
  console.log(
    `Never synced: ${summary.neverSyncedActiveConnectionCount} active connection${summary.neverSyncedActiveConnectionCount === 1 ? "" : "s"}`,
  );
  console.log(
    `Stale: ${summary.staleActiveConnectionCount} active connection${summary.staleActiveConnectionCount === 1 ? "" : "s"} over 24h old`,
  );
  console.log("");
  console.log("Local records");
  console.log(`Accounts: ${summary.recordCounts.accounts}`);
  console.log(`Holdings: ${summary.recordCounts.holdings}`);
  console.log(`Bank transactions: ${summary.recordCounts.bankTransactions}`);
  console.log(
    `Investment transactions: ${summary.recordCounts.investmentTransactions}`,
  );

  if (summary.connections.length === 0) {
    return;
  }

  console.log("");
  console.log("Connections");
  console.log(
    [
      pad("Provider", 11),
      pad("Connection", 26),
      pad("Status", 14),
      pad("State", 14),
      "Last successful sync",
    ].join(""),
  );
  console.log("-".repeat(88));

  for (const connection of summary.connections) {
    console.log(
      [
        pad(connection.provider, 11),
        pad(truncate(formatConnection(connection), 25), 26),
        pad(connection.status, 14),
        pad(connection.state, 14),
        formatDateTime(connection.lastSuccessfulSyncAt),
      ].join(""),
    );
  }
}

export function printSyncRuns(rows: SyncRunRow[]) {
  if (rows.length === 0) {
    console.log("No sync runs found.");
    return;
  }

  console.log(
    [
      pad("Run ID", 34),
      pad("Provider", 11),
      pad("Connection", 26),
      pad("Status", 12),
      pad("Started", 22),
      pad("Completed", 22),
      pad("Changed", 9),
      "Error",
    ].join(""),
  );
  console.log("-".repeat(150));

  for (const row of rows) {
    console.log(
      [
        pad(truncate(row.runId, 33), 34),
        pad(formatProvider(row.provider), 11),
        pad(truncate(formatConnection(row), 25), 26),
        pad(row.status, 12),
        pad(formatDateTime(row.startedAt), 22),
        pad(formatDateTime(row.completedAt), 22),
        pad(String(row.recordsChanged), 9),
        row.errorSummary ?? "",
      ].join(""),
    );
  }
}

export function printSyncRun(row: SyncRunRow) {
  console.log(`Sync Run ${row.runId}`);
  console.log(`Provider: ${formatProvider(row.provider)}`);
  console.log(`Connection: ${row.connectionId ?? "unknown"}`);
  console.log(`Institution: ${formatConnection(row)}`);
  console.log(`Status: ${row.status}`);
  console.log(`Trigger: ${row.trigger}`);
  console.log(`Started: ${formatDateTime(row.startedAt)}`);
  console.log(`Completed: ${formatDateTime(row.completedAt)}`);
  console.log(`Records changed: ${row.recordsChanged}`);

  if (row.errorSummary) {
    console.log(`Error: ${row.errorSummary}`);
  }
}
