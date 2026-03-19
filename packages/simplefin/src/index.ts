type SimplefinFetch = typeof fetch;

type SimplefinAccountSet = {
  accounts: SimplefinAccount[];
  errors: string[];
};

type SimplefinAccount = {
  balance: string;
  "balance-date": number;
  currency: string;
  id: string;
  name: string;
  org?: {
    domain?: string;
    name?: string;
    "sfin-url": string;
  };
  transactions?: SimplefinTransaction[];
};

type SimplefinTransaction = {
  amount: string;
  description: string;
  extra?: {
    category?: unknown;
  };
  id: string;
  pending?: boolean;
  posted: number;
};

type ProviderConnectionRow = {
  accessUrl: null | string;
  householdId: string;
  id: string;
  status: "active" | "disconnected" | "error";
};

type SyncCheckpointRow = {
  cursor: null | string;
};

type SyncSimplefinConnectionArgs = {
  connectionId: string;
  database: D1Database;
  fetchImpl?: SimplefinFetch;
  now?: Date;
};

type SyncSimplefinConnectionResult = {
  recordsChanged: number;
  runId: string;
  status: "succeeded";
};

const SIMPLEFIN_LOOKBACK_DAYS = 90;

function toEpochSeconds(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

function formatAsOfDate(epochSeconds: number) {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function escapeIdentifierSegment(value: string) {
  return value.replaceAll(":", "_");
}

function providerAccountRowId(connectionId: string, providerAccountId: string) {
  return `provacct:simplefin:${escapeIdentifierSegment(connectionId)}:${escapeIdentifierSegment(providerAccountId)}`;
}

function canonicalAccountId(connectionId: string, providerAccountId: string) {
  return `acct:simplefin:${escapeIdentifierSegment(connectionId)}:${escapeIdentifierSegment(providerAccountId)}`;
}

function snapshotId(runId: string, accountId: string) {
  return `snapshot:${runId}:${accountId}`;
}

function transactionRowId(accountId: string, providerTransactionId: string) {
  return `txn:${accountId}:${escapeIdentifierSegment(providerTransactionId)}`;
}

function checkpointId(connectionId: string) {
  return `checkpoint:${escapeIdentifierSegment(connectionId)}`;
}

function runId(connectionId: string, now: Date) {
  const compactTimestamp = now
    .toISOString()
    .replaceAll(/[-:.]/g, "")
    .replace("Z", "Z");
  return `sync:simplefin:${escapeIdentifierSegment(connectionId)}:${compactTimestamp}`;
}

function parseCurrencyAmountToMinor(value: string) {
  const trimmed = value.trim();

  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error(
      `SimpleFIN amount "${value}" is not a supported currency value.`,
    );
  }

  const isNegative = trimmed.startsWith("-");
  const normalized = isNegative ? trimmed.slice(1) : trimmed;
  const [wholePart, decimalPart = ""] = normalized.split(".");
  const minor =
    Number.parseInt(wholePart, 10) * 100 +
    Number.parseInt(decimalPart.padEnd(2, "0"), 10);

  return isNegative ? -minor : minor;
}

function inferCashAccountType(name: string): "checking" | "savings" {
  const normalizedName = name.toLowerCase();

  if (
    normalizedName.includes("savings") ||
    normalizedName.includes("money market")
  ) {
    return "savings";
  }

  return "checking";
}

function resolveInstitutionName(account: SimplefinAccount) {
  return account.org?.name ?? account.org?.domain ?? "Unknown institution";
}

function joinErrors(errors: string[]) {
  return errors.filter(Boolean).join(" ");
}

async function loadProviderConnection(
  database: D1Database,
  connectionId: string,
) {
  return database
    .prepare(
      `
        select
          id,
          household_id as householdId,
          status,
          access_url as accessUrl
        from provider_connections
        where id = ? and provider = ?
      `,
    )
    .bind(connectionId, "simplefin")
    .first<ProviderConnectionRow>();
}

async function loadCheckpoint(database: D1Database, connectionId: string) {
  return database
    .prepare(
      `
        select cursor
        from sync_checkpoints
        where provider_connection_id = ?
      `,
    )
    .bind(connectionId)
    .first<SyncCheckpointRow>();
}

function buildAccountsUrl(
  accessUrl: string,
  params: { endDate: number; startDate: number },
) {
  const url = new URL(accessUrl);

  if (url.protocol !== "https:") {
    throw new Error("SimpleFIN access URLs must use HTTPS.");
  }

  const username = url.username;
  const password = url.password;

  if (!username || !password) {
    throw new Error("SimpleFIN access URL is missing basic-auth credentials.");
  }

  url.username = "";
  url.password = "";

  const normalizedPath = url.pathname.endsWith("/")
    ? `${url.pathname}accounts`
    : `${url.pathname}/accounts`;
  const accountsUrl = new URL(url.toString());
  accountsUrl.pathname = normalizedPath;
  accountsUrl.searchParams.set("start-date", String(params.startDate));
  accountsUrl.searchParams.set("end-date", String(params.endDate));

  const authorization = `Basic ${btoa(`${username}:${password}`)}`;

  return {
    authorization,
    url: accountsUrl,
  };
}

async function fetchSimplefinAccountSet(args: {
  accessUrl: string;
  endDate: number;
  fetchImpl: SimplefinFetch;
  startDate: number;
}) {
  const request = buildAccountsUrl(args.accessUrl, {
    endDate: args.endDate,
    startDate: args.startDate,
  });
  const response = await args.fetchImpl(request.url, {
    headers: {
      authorization: request.authorization,
    },
  });

  if (!response.ok) {
    throw new Error(`SimpleFIN /accounts returned ${response.status}.`);
  }

  const data = (await response.json()) as SimplefinAccountSet;

  return {
    accounts: data.accounts ?? [],
    errors: data.errors ?? [],
  };
}

async function insertRunningSyncRun(args: {
  connection: ProviderConnectionRow;
  database: D1Database;
  now: Date;
  runId: string;
}) {
  await args.database
    .prepare(
      `
        insert into sync_runs (
          id,
          household_id,
          provider_connection_id,
          provider,
          status,
          trigger,
          records_changed,
          started_at,
          completed_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      args.runId,
      args.connection.householdId,
      args.connection.id,
      "simplefin",
      "running",
      "scheduled",
      0,
      args.now.getTime(),
      null,
    )
    .run();
}

async function markSyncRunFailed(args: {
  database: D1Database;
  errorSummary: string;
  failedAt: Date;
  runId: string;
}) {
  await args.database.batch([
    args.database
      .prepare(
        `
          update sync_runs
          set status = ?, completed_at = ?, error_summary = ?
          where id = ?
        `,
      )
      .bind("failed", args.failedAt.getTime(), args.errorSummary, args.runId),
  ]);
}

async function finalizeSuccessfulSync(args: {
  accountSet: SimplefinAccountSet;
  completionTime: Date;
  connection: ProviderConnectionRow;
  database: D1Database;
  endDate: number;
  runId: string;
}) {
  const completionTimeMs = args.completionTime.getTime();
  const statements: D1PreparedStatement[] = [];

  for (const account of args.accountSet.accounts) {
    const inferredAccountType = inferCashAccountType(account.name);
    const institutionName = resolveInstitutionName(account);
    const providerAccountId = providerAccountRowId(
      args.connection.id,
      account.id,
    );
    const accountId = canonicalAccountId(args.connection.id, account.id);
    const balanceMinor = parseCurrencyAmountToMinor(account.balance);

    statements.push(
      args.database
        .prepare(
          `
            insert into provider_accounts (
              id,
              provider_connection_id,
              provider_account_id,
              name,
              institution_name,
              account_type,
              account_subtype,
              currency,
              created_at,
              updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(id) do update set
              name = excluded.name,
              institution_name = excluded.institution_name,
              account_type = excluded.account_type,
              account_subtype = excluded.account_subtype,
              currency = excluded.currency,
              updated_at = excluded.updated_at
          `,
        )
        .bind(
          providerAccountId,
          args.connection.id,
          account.id,
          account.name,
          institutionName,
          inferredAccountType,
          inferredAccountType,
          account.currency,
          completionTimeMs,
          completionTimeMs,
        ),
    );

    statements.push(
      args.database
        .prepare(
          `
            insert into accounts (
              id,
              household_id,
              provider_account_id,
              name,
              institution_name,
              account_type,
              account_subtype,
              currency,
              ownership_type,
              include_in_household_reporting,
              is_hidden,
              reporting_group,
              balance_minor,
              created_at,
              updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(id) do update set
              provider_account_id = excluded.provider_account_id,
              name = excluded.name,
              institution_name = excluded.institution_name,
              account_type = excluded.account_type,
              account_subtype = excluded.account_subtype,
              currency = excluded.currency,
              reporting_group = excluded.reporting_group,
              balance_minor = excluded.balance_minor,
              updated_at = excluded.updated_at
          `,
        )
        .bind(
          accountId,
          args.connection.householdId,
          providerAccountId,
          account.name,
          institutionName,
          inferredAccountType,
          inferredAccountType,
          account.currency,
          "joint",
          1,
          0,
          "cash",
          balanceMinor,
          completionTimeMs,
          completionTimeMs,
        ),
    );

    statements.push(
      args.database
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
          snapshotId(args.runId, accountId),
          accountId,
          args.runId,
          completionTimeMs,
          formatAsOfDate(account["balance-date"]),
          balanceMinor,
        ),
    );

    for (const transaction of account.transactions ?? []) {
      if (transaction.pending || transaction.posted <= 0) {
        continue;
      }

      const amountMinor = parseCurrencyAmountToMinor(transaction.amount);
      const categoryRaw =
        typeof transaction.extra?.category === "string"
          ? transaction.extra.category
          : null;

      statements.push(
        args.database
          .prepare(
            `
              insert into transactions (
                id,
                account_id,
                provider_transaction_id,
                posted_at,
                amount_minor,
                direction,
                description,
                merchant_name,
                category_raw,
                category_normalized,
                exclude_from_reporting,
                source_sync_run_id
              )
              values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              on conflict(account_id, provider_transaction_id) do update set
                posted_at = excluded.posted_at,
                amount_minor = excluded.amount_minor,
                direction = excluded.direction,
                description = excluded.description,
                merchant_name = excluded.merchant_name,
                category_raw = excluded.category_raw,
                source_sync_run_id = excluded.source_sync_run_id
            `,
          )
          .bind(
            transactionRowId(accountId, transaction.id),
            accountId,
            transaction.id,
            transaction.posted * 1000,
            amountMinor,
            amountMinor >= 0 ? "credit" : "debit",
            transaction.description,
            transaction.description,
            categoryRaw,
            null,
            0,
            args.runId,
          ),
      );
    }
  }

  statements.push(
    args.database
      .prepare(
        `
          insert into sync_checkpoints (
            id,
            provider_connection_id,
            cursor,
            updated_at
          )
          values (?, ?, ?, ?)
          on conflict(provider_connection_id) do update set
            cursor = excluded.cursor,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        checkpointId(args.connection.id),
        args.connection.id,
        String(args.endDate),
        completionTimeMs,
      ),
  );

  const errorSummary = joinErrors(args.accountSet.errors);
  const recordsChanged =
    args.accountSet.accounts.length +
    args.accountSet.accounts.length +
    args.accountSet.accounts.reduce((count, account) => {
      return (
        count +
        (account.transactions ?? []).filter((transaction) => {
          return !transaction.pending && transaction.posted > 0;
        }).length
      );
    }, 0);

  statements.push(
    args.database
      .prepare(
        `
          update sync_runs
          set status = ?, completed_at = ?, records_changed = ?, error_summary = ?
          where id = ?
        `,
      )
      .bind(
        "succeeded",
        completionTimeMs,
        recordsChanged,
        errorSummary || null,
        args.runId,
      ),
  );
  statements.push(
    args.database
      .prepare(
        `
          update households
          set last_synced_at = ?
          where id = ?
        `,
      )
      .bind(completionTimeMs, args.connection.householdId),
  );

  await args.database.batch(statements);

  return recordsChanged;
}

export async function syncSimplefinConnection(
  args: SyncSimplefinConnectionArgs,
): Promise<SyncSimplefinConnectionResult> {
  const now = args.now ?? new Date();
  const fetchImpl = args.fetchImpl ?? fetch;
  const connection = await loadProviderConnection(
    args.database,
    args.connectionId,
  );

  if (!connection) {
    throw new Error(
      `SimpleFIN connection ${args.connectionId} could not be found.`,
    );
  }

  if (connection.status !== "active") {
    throw new Error(`SimpleFIN connection ${args.connectionId} is not active.`);
  }

  if (!connection.accessUrl) {
    throw new Error(
      `SimpleFIN connection ${args.connectionId} is missing an access URL.`,
    );
  }

  const currentRunId = runId(args.connectionId, now);
  await insertRunningSyncRun({
    connection,
    database: args.database,
    now,
    runId: currentRunId,
  });

  try {
    await loadCheckpoint(args.database, args.connectionId);
    const endDate = toEpochSeconds(now);
    const startDate = endDate - SIMPLEFIN_LOOKBACK_DAYS * 24 * 60 * 60;
    const accountSet = await fetchSimplefinAccountSet({
      accessUrl: connection.accessUrl,
      endDate,
      fetchImpl,
      startDate,
    });
    const recordsChanged = await finalizeSuccessfulSync({
      accountSet,
      completionTime: now,
      connection,
      database: args.database,
      endDate,
      runId: currentRunId,
    });

    return {
      recordsChanged,
      runId: currentRunId,
      status: "succeeded",
    };
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : `SimpleFIN sync failed for connection ${args.connectionId}.`;
    const normalizedReason = reason.includes("/accounts returned 403")
      ? `SimpleFIN /accounts returned 403 for connection ${args.connectionId}.`
      : reason;

    await markSyncRunFailed({
      database: args.database,
      errorSummary: normalizedReason,
      failedAt: now,
      runId: currentRunId,
    });
    throw new Error(normalizedReason);
  }
}

export async function syncConfiguredSimplefinConnections(args: {
  database: D1Database;
  fetchImpl?: SimplefinFetch;
  now?: Date;
}) {
  const connections = await args.database
    .prepare(
      `
        select id
        from provider_connections
        where provider = ?
          and status = ?
          and access_url is not null
      `,
    )
    .bind("simplefin", "active")
    .all<{ id: string }>();

  const results = [];

  for (const connection of connections.results) {
    results.push(
      await syncSimplefinConnection({
        connectionId: connection.id,
        database: args.database,
        fetchImpl: args.fetchImpl,
        now: args.now,
      }),
    );
  }

  return results;
}
