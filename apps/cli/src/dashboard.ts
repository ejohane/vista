import type { LocalD1Database } from "./local-d1";

type DashboardSummary = {
  accountCount: number;
  bankTransactionCount: number;
  cashMinor: number;
  connectionCount: number;
  holdingCount: number;
  investmentTransactionCount: number;
  investmentsMinor: number;
  lastCompletedSyncAt: null | number;
  lastFailedSyncAt: null | number;
  liabilitiesMinor: number;
};

type ConnectionRow = {
  institutionName: string;
  lastCompletedSyncAt: null | number;
  status: string;
};

function formatUsd(minor: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(minor / 100);
}

function formatDateTime(timestamp: null | number) {
  if (timestamp === null) {
    return "never";
  }

  return new Date(timestamp).toISOString().replace(".000Z", "Z");
}

function pad(value: string, length: number) {
  return value.padEnd(length, " ");
}

export async function getDashboardSummary(database: LocalD1Database) {
  return database
    .prepare(
      `
        select
          coalesce(sum(case when reporting_group = 'cash' then balance_minor else 0 end), 0) as cashMinor,
          coalesce(sum(case when reporting_group = 'investments' then balance_minor else 0 end), 0) as investmentsMinor,
          coalesce(sum(case when reporting_group = 'liabilities' then balance_minor else 0 end), 0) as liabilitiesMinor,
          (select count(*) from accounts) as accountCount,
          (select count(*) from holdings) as holdingCount,
          (select count(*) from transactions) as bankTransactionCount,
          (select count(*) from investment_transactions) as investmentTransactionCount,
          (select count(*) from provider_connections where provider = 'plaid') as connectionCount,
          (
            select max(completed_at)
            from sync_runs
            where status = 'succeeded'
              and completed_at is not null
          ) as lastCompletedSyncAt,
          (
            select max(completed_at)
            from sync_runs
            where status = 'failed'
              and completed_at is not null
          ) as lastFailedSyncAt
        from accounts
        where include_in_household_reporting = 1
          and is_hidden = 0
      `,
    )
    .first<DashboardSummary>();
}

export async function listDashboardConnections(database: LocalD1Database) {
  const rows = await database
    .prepare(
      `
        select
          coalesce(pc.institution_name, 'Plaid') as institutionName,
          pc.status,
          (
            select max(sr.completed_at)
            from sync_runs sr
            where sr.provider_connection_id = pc.id
              and sr.status = 'succeeded'
              and sr.completed_at is not null
          ) as lastCompletedSyncAt
        from provider_connections pc
        where pc.provider = 'plaid'
        order by pc.institution_name asc, pc.id asc
      `,
    )
    .all<ConnectionRow>();

  return rows.results;
}

export async function printDashboard(database: LocalD1Database) {
  const summary = await getDashboardSummary(database);
  const connections = await listDashboardConnections(database);

  if (!summary) {
    console.log("No dashboard data found. Run `bun run cli -- sync` first.");
    return;
  }

  const netWorthMinor =
    summary.cashMinor + summary.investmentsMinor + summary.liabilitiesMinor;

  console.log("Vista Dashboard");
  console.log(`Last sync: ${formatDateTime(summary.lastCompletedSyncAt)}`);

  if (summary.lastFailedSyncAt !== null) {
    console.log(
      `Last failed sync: ${formatDateTime(summary.lastFailedSyncAt)}`,
    );
  }

  console.log("");
  console.log(`${pad("Net worth:", 14)}${formatUsd(netWorthMinor)}`);
  console.log(`${pad("Cash:", 14)}${formatUsd(summary.cashMinor)}`);
  console.log(
    `${pad("Investments:", 14)}${formatUsd(summary.investmentsMinor)}`,
  );
  console.log(
    `${pad("Liabilities:", 14)}${formatUsd(summary.liabilitiesMinor)}`,
  );
  console.log("");
  console.log(`${pad("Accounts:", 18)}${summary.accountCount}`);
  console.log(`${pad("Holdings:", 18)}${summary.holdingCount}`);
  console.log(`${pad("Bank txns:", 18)}${summary.bankTransactionCount}`);
  console.log(
    `${pad("Investment txns:", 18)}${summary.investmentTransactionCount}`,
  );
  console.log(`${pad("Connections:", 18)}${summary.connectionCount}`);

  if (connections.length === 0) {
    return;
  }

  console.log("");
  console.log("Connections");
  console.log(
    [pad("Institution", 24), pad("Status", 14), "Last successful sync"].join(
      "",
    ),
  );
  console.log("-".repeat(62));

  for (const connection of connections) {
    console.log(
      [
        pad(connection.institutionName.slice(0, 23), 24),
        pad(connection.status, 14),
        formatDateTime(connection.lastCompletedSyncAt),
      ].join(""),
    );
  }
}
