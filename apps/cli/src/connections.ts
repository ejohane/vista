import type { LocalD1Database } from "./local-d1";

type Provider = "coinbase" | "plaid";

type SyncStatus = "failed" | "running" | "succeeded";

export type ConnectionRow = {
  createdAt: number;
  externalConnectionId: string;
  id: string;
  institutionId: null | string;
  institutionName: null | string;
  latestSyncAt: null | number;
  latestSyncError: null | string;
  latestSyncStatus: null | SyncStatus;
  lastSuccessfulSyncAt: null | number;
  provider: Provider;
  status: string;
  updatedAt: number;
};

export type ConnectionDetail = ConnectionRow & {
  accountCount: number;
  hasAccessSecret: boolean;
  hasAccessToken: boolean;
  holdingCount: number;
  syncRunCount: number;
};

export type ConnectionTestResult = {
  checks: Array<{
    ok: boolean;
    status: string;
    value: string;
  }>;
  connection: ConnectionDetail;
  ok: boolean;
};

type ConnectionArgs =
  | {
      kind: "list";
    }
  | {
      connectionId: string;
      kind: "show" | "test";
    }
  | {
      connectionId: string;
      kind: "remove";
      yes: boolean;
    };

function formatDateTime(timestamp: null | number) {
  if (timestamp === null) {
    return "never";
  }

  return new Date(timestamp).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function pad(value: string, length: number) {
  return value.padEnd(length, " ");
}

function connectionDisplayName(
  connection: Pick<ConnectionRow, "institutionName" | "provider">,
) {
  return (
    connection.institutionName?.trim() ||
    providerDisplayName(connection.provider)
  );
}

function providerDisplayName(provider: Provider) {
  if (provider === "coinbase") {
    return "Coinbase";
  }

  return "Plaid";
}

export function parseConnectionsArgs(argv: string[]): ConnectionArgs {
  const [subcommand, connectionId, ...rest] = argv;

  if (!subcommand) {
    return {
      kind: "list",
    };
  }

  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    return {
      kind: "list",
    };
  }

  if (subcommand === "show" || subcommand === "test") {
    if (!connectionId?.trim()) {
      throw new Error(
        `vista connections ${subcommand} requires a connection id.`,
      );
    }

    const unexpectedArg = rest.find(Boolean);

    if (unexpectedArg) {
      throw new Error(
        `Unknown connections ${subcommand} option: ${unexpectedArg}`,
      );
    }

    return {
      connectionId,
      kind: subcommand,
    };
  }

  if (subcommand === "remove") {
    if (!connectionId?.trim()) {
      throw new Error("vista connections remove requires a connection id.");
    }

    let yes = false;

    for (const arg of rest) {
      if (arg === "--yes" || arg === "-y") {
        yes = true;
        continue;
      }

      throw new Error(`Unknown connections remove option: ${arg}`);
    }

    return {
      connectionId,
      kind: "remove",
      yes,
    };
  }

  throw new Error(`Unknown connections command: ${subcommand}`);
}

export function printConnectionsHelp() {
  console.log(`Vista connection commands

Usage:
  vista connections
  vista connections show <id>
  vista connections test <id>
  vista connections remove <id> --yes

Notes:
  test performs local validation only; it does not call Plaid or Coinbase.
  remove clears stored credentials and marks the connection disconnected.
`);
}

export async function listConnections(database: LocalD1Database) {
  const rows = await database
    .prepare(
      `
        select
          pc.id,
          pc.provider,
          pc.status,
          pc.external_connection_id as externalConnectionId,
          pc.institution_id as institutionId,
          pc.institution_name as institutionName,
          pc.created_at as createdAt,
          pc.updated_at as updatedAt,
          (
            select max(sr.completed_at)
            from sync_runs sr
            where sr.provider_connection_id = pc.id
              and sr.status = 'succeeded'
              and sr.completed_at is not null
          ) as lastSuccessfulSyncAt,
          latest_sync.status as latestSyncStatus,
          latest_sync.completed_at as latestSyncAt,
          latest_sync.error_summary as latestSyncError
        from provider_connections pc
        left join sync_runs latest_sync on latest_sync.id = (
          select sr.id
          from sync_runs sr
          where sr.provider_connection_id = pc.id
          order by sr.started_at desc, sr.completed_at desc, sr.id desc
          limit 1
        )
        order by pc.provider asc, coalesce(pc.institution_name, pc.provider) asc, pc.id asc
      `,
    )
    .all<ConnectionRow>();

  return rows.results;
}

export async function getConnection(
  database: LocalD1Database,
  connectionId: string,
) {
  const connection = await database
    .prepare(
      `
        select
          pc.id,
          pc.provider,
          pc.status,
          pc.external_connection_id as externalConnectionId,
          pc.institution_id as institutionId,
          pc.institution_name as institutionName,
          pc.created_at as createdAt,
          pc.updated_at as updatedAt,
          pc.access_token is not null or pc.access_token_encrypted is not null as hasAccessToken,
          pc.access_secret is not null or pc.access_secret_encrypted is not null as hasAccessSecret,
          (
            select count(*)
            from provider_accounts pa
            where pa.provider_connection_id = pc.id
          ) as accountCount,
          (
            select count(*)
            from provider_accounts pa
            join accounts a on a.provider_account_id = pa.id
            join holdings h on h.account_id = a.id
            where pa.provider_connection_id = pc.id
          ) as holdingCount,
          (
            select count(*)
            from sync_runs sr
            where sr.provider_connection_id = pc.id
          ) as syncRunCount,
          (
            select max(sr.completed_at)
            from sync_runs sr
            where sr.provider_connection_id = pc.id
              and sr.status = 'succeeded'
              and sr.completed_at is not null
          ) as lastSuccessfulSyncAt,
          latest_sync.status as latestSyncStatus,
          latest_sync.completed_at as latestSyncAt,
          latest_sync.error_summary as latestSyncError
        from provider_connections pc
        left join sync_runs latest_sync on latest_sync.id = (
          select sr.id
          from sync_runs sr
          where sr.provider_connection_id = pc.id
          order by sr.started_at desc, sr.completed_at desc, sr.id desc
          limit 1
        )
        where pc.id = ?
        limit 1
      `,
    )
    .bind(connectionId)
    .first<
      Omit<
        ConnectionDetail,
        | "accountCount"
        | "hasAccessSecret"
        | "hasAccessToken"
        | "holdingCount"
        | "syncRunCount"
      > & {
        accountCount: number;
        hasAccessSecret: 0 | 1;
        hasAccessToken: 0 | 1;
        holdingCount: number;
        syncRunCount: number;
      }
    >();

  if (!connection) {
    throw new Error(`Connection not found: ${connectionId}`);
  }

  return {
    ...connection,
    hasAccessSecret: Boolean(connection.hasAccessSecret),
    hasAccessToken: Boolean(connection.hasAccessToken),
  } satisfies ConnectionDetail;
}

export async function testConnection(
  database: LocalD1Database,
  connectionId: string,
) {
  const connection = await getConnection(database, connectionId);
  const credentialChecks =
    connection.provider === "coinbase"
      ? [
          {
            ok: connection.hasAccessToken,
            status: "Coinbase API key name credential",
            value: connection.hasAccessToken ? "present" : "missing",
          },
          {
            ok: connection.hasAccessSecret,
            status: "Coinbase private key credential",
            value: connection.hasAccessSecret ? "present" : "missing",
          },
        ]
      : [
          {
            ok: connection.hasAccessToken,
            status: "Plaid access token credential",
            value: connection.hasAccessToken ? "present" : "missing",
          },
        ];
  const checks = [
    {
      ok: connection.status === "active",
      status: "Connection status",
      value: connection.status,
    },
    {
      ok: connection.externalConnectionId.trim().length > 0,
      status: "External connection id",
      value: connection.externalConnectionId.trim() ? "present" : "missing",
    },
    ...credentialChecks,
  ];

  return {
    checks,
    connection,
    ok: checks.every((check) => check.ok),
  } satisfies ConnectionTestResult;
}

export async function removeConnection(args: {
  connectionId: string;
  database: LocalD1Database;
  now?: Date;
  yes: boolean;
}) {
  if (!args.yes) {
    throw new Error(
      "Refusing to remove connection without --yes. This clears stored credentials and marks the connection disconnected.",
    );
  }

  await getConnection(args.database, args.connectionId);

  const now = args.now ?? new Date();
  const result = await args.database
    .prepare(
      `
        update provider_connections
        set
          status = 'disconnected',
          access_token = null,
          access_token_encrypted = null,
          access_secret = null,
          access_secret_encrypted = null,
          updated_at = ?
        where id = ?
      `,
    )
    .bind(now.getTime(), args.connectionId)
    .run();

  return result.meta.changes;
}

export function printConnections(connections: ConnectionRow[]) {
  if (connections.length === 0) {
    console.log("No provider connections found.");
    return;
  }

  console.log(
    [
      pad("ID", 54),
      pad("Provider", 11),
      pad("Name", 24),
      pad("Status", 14),
      pad("Last successful sync", 23),
      pad("Latest sync", 15),
      pad("Created", 23),
      "Updated",
    ].join(""),
  );
  console.log("-".repeat(184));

  for (const connection of connections) {
    console.log(
      [
        pad(connection.id, 54),
        pad(connection.provider, 11),
        pad(connectionDisplayName(connection).slice(0, 23), 24),
        pad(connection.status, 14),
        pad(formatDateTime(connection.lastSuccessfulSyncAt), 23),
        pad(connection.latestSyncStatus ?? "never", 15),
        pad(formatDateTime(connection.createdAt), 23),
        formatDateTime(connection.updatedAt),
      ].join(""),
    );
  }
}

export function printConnectionDetail(connection: ConnectionDetail) {
  console.log(`Connection: ${connection.id}`);
  console.log(`Provider: ${connection.provider}`);
  console.log(`Name: ${connectionDisplayName(connection)}`);
  console.log(`Status: ${connection.status}`);
  console.log(`External ID: ${connection.externalConnectionId}`);
  console.log(`Institution ID: ${connection.institutionId ?? "-"}`);
  console.log(`Created: ${formatDateTime(connection.createdAt)}`);
  console.log(`Updated: ${formatDateTime(connection.updatedAt)}`);
  console.log(
    `Last successful sync: ${formatDateTime(connection.lastSuccessfulSyncAt)}`,
  );
  console.log(`Latest sync status: ${connection.latestSyncStatus ?? "never"}`);
  console.log(
    `Latest sync completed: ${formatDateTime(connection.latestSyncAt)}`,
  );

  if (connection.latestSyncError) {
    console.log(`Latest sync error: ${connection.latestSyncError}`);
  }

  console.log(`Sync runs: ${connection.syncRunCount}`);
  console.log(`Accounts: ${connection.accountCount}`);
  console.log(`Holdings: ${connection.holdingCount}`);
  console.log(
    `Access token/key: ${connection.hasAccessToken ? "present" : "missing"}`,
  );
  console.log(
    `Access secret/key material: ${connection.hasAccessSecret ? "present" : "missing"}`,
  );
}

export function printConnectionTest(result: ConnectionTestResult) {
  console.log(`Connection: ${result.connection.id}`);
  console.log(`Local validation: ${result.ok ? "passed" : "failed"}`);
  console.log("");

  for (const check of result.checks) {
    console.log(
      `${check.ok ? "ok" : "fail"}  ${pad(check.status, 34)}${check.value}`,
    );
  }
}

export async function runConnectionsCommand(
  database: LocalD1Database,
  args: ConnectionArgs,
) {
  if (args.kind === "list") {
    printConnections(await listConnections(database));
    return;
  }

  if (args.kind === "show") {
    printConnectionDetail(await getConnection(database, args.connectionId));
    return;
  }

  if (args.kind === "test") {
    printConnectionTest(await testConnection(database, args.connectionId));
    return;
  }

  if (args.kind === "remove") {
    const changed = await removeConnection({
      connectionId: args.connectionId,
      database,
      yes: args.yes,
    });

    console.log(
      `Removed connection credentials and marked ${args.connectionId} disconnected (${changed} updated).`,
    );
  }
}
