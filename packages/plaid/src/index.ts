type PlaidEnvironment = "development" | "production" | "sandbox";

type PlaidApiAccount = {
  account_id: string;
  balances: {
    available?: null | number;
    current?: null | number;
    iso_currency_code?: null | string;
    limit?: null | number;
    unofficial_currency_code?: null | string;
  };
  mask?: null | string;
  name: string;
  official_name?: null | string;
  subtype?: null | string;
  type: string;
};

type PlaidClientConfig = {
  clientId: string;
  environment?: PlaidEnvironment;
  secret: string;
};

type PlaidApiResponse<T> = T & {
  request_id?: string;
};

type PlaidConnectionRow = {
  accessToken: null | string;
  householdId: string;
  id: string;
  institutionName: null | string;
  status: "active" | "disconnected" | "error";
};

type PlaidFetch = typeof fetch;

type PlaidSyncConnectionArgs = {
  client?: PlaidClient;
  clientFactory?: (config: PlaidClientConfig) => PlaidClient;
  clientId?: string;
  connectionId: string;
  database: D1Database;
  environment?: PlaidEnvironment;
  now?: Date;
  secret?: string;
};

type PlaidSyncConnectionResult = {
  recordsChanged: number;
  runId: string;
  status: "succeeded";
};

type PlaidSyncConfiguredConnectionsArgs = {
  client?: PlaidClient;
  clientFactory?: (config: PlaidClientConfig) => PlaidClient;
  clientId?: string;
  database: D1Database;
  environment?: PlaidEnvironment;
  now?: Date;
  secret?: string;
};

export type PlaidClient = {
  createLinkToken(args: {
    countryCodes?: string[];
    language?: string;
    products: string[];
    requiredIfSupportedProducts?: string[];
    redirectUri?: string;
    userId: string;
  }): Promise<{
    expiration: string;
    linkToken: string;
  }>;
  exchangePublicToken(args: { publicToken: string }): Promise<{
    accessToken: string;
    itemId: string;
  }>;
  getAccounts(args: { accessToken: string }): Promise<{
    accounts: PlaidApiAccount[];
    item?: {
      institution_id?: null | string;
      item_id?: string;
    };
  }>;
};

function resolvePlaidBaseUrl(environment: PlaidEnvironment = "sandbox") {
  if (environment === "production") {
    return "https://production.plaid.com";
  }

  if (environment === "development") {
    return "https://development.plaid.com";
  }

  return "https://sandbox.plaid.com";
}

function escapeIdentifierSegment(value: string) {
  return value.replaceAll(":", "_");
}

function providerAccountRowId(connectionId: string, providerAccountId: string) {
  return `provacct:plaid:${escapeIdentifierSegment(connectionId)}:${escapeIdentifierSegment(providerAccountId)}`;
}

function canonicalAccountId(connectionId: string, providerAccountId: string) {
  return `acct:plaid:${escapeIdentifierSegment(connectionId)}:${escapeIdentifierSegment(providerAccountId)}`;
}

function snapshotId(runIdValue: string, accountId: string) {
  return `snapshot:${runIdValue}:${accountId}`;
}

function runId(connectionId: string, now: Date) {
  const compactTimestamp = now
    .toISOString()
    .replaceAll(/[-:.]/g, "")
    .replace("Z", "Z");
  return `sync:plaid:${escapeIdentifierSegment(connectionId)}:${compactTimestamp}`;
}

function toMinorUnits(value: null | number | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 0;
  }

  return Math.round(value * 100);
}

function normalizeCurrency(account: PlaidApiAccount) {
  return (
    account.balances.iso_currency_code ??
    account.balances.unofficial_currency_code ??
    "USD"
  );
}

function normalizeInstitutionName(connection: PlaidConnectionRow) {
  return connection.institutionName?.trim() || "Plaid";
}

function inferPlaidAccountClassification(account: PlaidApiAccount) {
  const subtype = account.subtype?.toLowerCase() ?? "";

  if (account.type === "investment") {
    if (
      subtype.includes("401") ||
      subtype.includes("403") ||
      subtype.includes("ira") ||
      subtype.includes("pension") ||
      subtype.includes("retirement")
    ) {
      return {
        accountSubtype: account.subtype ?? "retirement",
        accountType: "retirement" as const,
        reportingGroup: "investments" as const,
      };
    }

    return {
      accountSubtype: account.subtype ?? "brokerage",
      accountType: "brokerage" as const,
      reportingGroup: "investments" as const,
    };
  }

  if (account.type === "credit") {
    if (subtype.includes("line of credit")) {
      return {
        accountSubtype: account.subtype ?? "line_of_credit",
        accountType: "line_of_credit" as const,
        reportingGroup: "liabilities" as const,
      };
    }

    return {
      accountSubtype: account.subtype ?? "credit_card",
      accountType: "credit_card" as const,
      reportingGroup: "liabilities" as const,
    };
  }

  if (account.type === "loan") {
    if (subtype.includes("mortgage") || subtype.includes("home equity")) {
      return {
        accountSubtype: account.subtype ?? "mortgage",
        accountType: "mortgage" as const,
        reportingGroup: "liabilities" as const,
      };
    }

    if (subtype.includes("student")) {
      return {
        accountSubtype: account.subtype ?? "student_loan",
        accountType: "student_loan" as const,
        reportingGroup: "liabilities" as const,
      };
    }

    if (subtype.includes("line of credit")) {
      return {
        accountSubtype: account.subtype ?? "line_of_credit",
        accountType: "line_of_credit" as const,
        reportingGroup: "liabilities" as const,
      };
    }

    return {
      accountSubtype: account.subtype ?? "loan",
      accountType: "loan" as const,
      reportingGroup: "liabilities" as const,
    };
  }

  if (subtype.includes("savings") || subtype.includes("money market")) {
    return {
      accountSubtype: account.subtype ?? "savings",
      accountType: "savings" as const,
      reportingGroup: "cash" as const,
    };
  }

  return {
    accountSubtype: account.subtype ?? "checking",
    accountType: "checking" as const,
    reportingGroup: "cash" as const,
  };
}

function normalizeBalanceMinor(account: PlaidApiAccount) {
  const classification = inferPlaidAccountClassification(account);
  const currentMinor = toMinorUnits(account.balances.current);

  if (classification.reportingGroup === "liabilities") {
    return -Math.abs(currentMinor);
  }

  return currentMinor;
}

async function requestPlaid<T>(args: {
  baseUrl: string;
  body: Record<string, unknown>;
  clientId: string;
  fetchImpl: PlaidFetch;
  path: string;
  secret: string;
}) {
  const response = await args.fetchImpl(`${args.baseUrl}${args.path}`, {
    body: JSON.stringify({
      client_id: args.clientId,
      secret: args.secret,
      ...args.body,
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Plaid ${args.path} returned ${response.status}.`);
  }

  return (await response.json()) as PlaidApiResponse<T>;
}

export function createPlaidClient(
  config: PlaidClientConfig,
  fetchImpl: PlaidFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    globalThis.fetch(input, init)) as PlaidFetch,
): PlaidClient {
  const baseUrl = resolvePlaidBaseUrl(config.environment);

  return {
    async createLinkToken(args) {
      const response = await requestPlaid<{
        expiration: string;
        link_token: string;
      }>({
        baseUrl,
        body: {
          client_name: "Vista",
          country_codes: args.countryCodes ?? ["US"],
          language: args.language ?? "en",
          products: args.products,
          required_if_supported_products: args.requiredIfSupportedProducts,
          redirect_uri: args.redirectUri,
          user: {
            client_user_id: args.userId,
          },
        },
        clientId: config.clientId,
        fetchImpl,
        path: "/link/token/create",
        secret: config.secret,
      });

      return {
        expiration: response.expiration,
        linkToken: response.link_token,
      };
    },

    async exchangePublicToken(args) {
      const response = await requestPlaid<{
        access_token: string;
        item_id: string;
      }>({
        baseUrl,
        body: {
          public_token: args.publicToken,
        },
        clientId: config.clientId,
        fetchImpl,
        path: "/item/public_token/exchange",
        secret: config.secret,
      });

      return {
        accessToken: response.access_token,
        itemId: response.item_id,
      };
    },

    async getAccounts(args) {
      const response = await requestPlaid<{
        accounts: PlaidApiAccount[];
        item?: {
          institution_id?: null | string;
          item_id?: string;
        };
      }>({
        baseUrl,
        body: {
          access_token: args.accessToken,
        },
        clientId: config.clientId,
        fetchImpl,
        path: "/accounts/get",
        secret: config.secret,
      });

      return {
        accounts: response.accounts ?? [],
        item: response.item,
      };
    },
  };
}

function resolvePlaidClient(args: {
  client?: PlaidClient;
  clientFactory?: (config: PlaidClientConfig) => PlaidClient;
  clientId?: string;
  environment?: PlaidEnvironment;
  secret?: string;
}) {
  return (
    args.client ??
    (args.clientId && args.secret
      ? (args.clientFactory ?? createPlaidClient)({
          clientId: args.clientId,
          environment: args.environment,
          secret: args.secret,
        })
      : null)
  );
}

async function loadProviderConnection(
  database: D1Database,
  connectionId: string,
) {
  return database
    .prepare(
      `
        select
          access_token as accessToken,
          household_id as householdId,
          id,
          institution_name as institutionName,
          status
        from provider_connections
        where id = ? and provider = ?
      `,
    )
    .bind(connectionId, "plaid")
    .first<PlaidConnectionRow>();
}

async function insertRunningSyncRun(args: {
  connection: PlaidConnectionRow;
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
          started_at,
          records_changed
        )
        values (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      args.runId,
      args.connection.householdId,
      args.connection.id,
      "plaid",
      "running",
      "scheduled",
      args.now.getTime(),
      0,
    )
    .run();
}

async function completeSyncRun(args: {
  database: D1Database;
  now: Date;
  recordsChanged: number;
  runId: string;
}) {
  await args.database
    .prepare(
      `
        update sync_runs
        set
          completed_at = ?,
          records_changed = ?,
          status = ?
        where id = ?
      `,
    )
    .bind(args.now.getTime(), args.recordsChanged, "succeeded", args.runId)
    .run();
}

async function failSyncRun(args: {
  database: D1Database;
  errorSummary: string;
  runId: string;
}) {
  await args.database
    .prepare(
      `
        update sync_runs
        set
          completed_at = ?,
          error_summary = ?,
          status = ?
        where id = ?
      `,
    )
    .bind(Date.now(), args.errorSummary, "failed", args.runId)
    .run();
}

async function upsertPlaidAccount(args: {
  account: PlaidApiAccount;
  connection: PlaidConnectionRow;
  database: D1Database;
  now: Date;
  runId: string;
}) {
  const classification = inferPlaidAccountClassification(args.account);
  const providerAccountId = providerAccountRowId(
    args.connection.id,
    args.account.account_id,
  );
  const accountId = canonicalAccountId(
    args.connection.id,
    args.account.account_id,
  );
  const institutionName = normalizeInstitutionName(args.connection);
  const displayName = args.account.official_name?.trim() || args.account.name;
  const balanceMinor = normalizeBalanceMinor(args.account);
  const asOfDate = args.now.toISOString().slice(0, 10);

  await args.database.batch([
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
        args.account.account_id,
        displayName,
        institutionName,
        classification.accountType,
        classification.accountSubtype,
        normalizeCurrency(args.account),
        args.now.getTime(),
        args.now.getTime(),
      ),
    args.database
      .prepare(
        `
          insert into accounts (
            id,
            household_id,
            provider_account_id,
            name,
            display_name,
            institution_name,
            account_type,
            account_subtype,
            reporting_group,
            balance_minor,
            currency,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(id) do update set
            name = excluded.name,
            display_name = excluded.display_name,
            institution_name = excluded.institution_name,
            account_type = excluded.account_type,
            account_subtype = excluded.account_subtype,
            reporting_group = excluded.reporting_group,
            balance_minor = excluded.balance_minor,
            currency = excluded.currency,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        accountId,
        args.connection.householdId,
        providerAccountId,
        displayName,
        displayName,
        institutionName,
        classification.accountType,
        classification.accountSubtype,
        classification.reportingGroup,
        balanceMinor,
        normalizeCurrency(args.account),
        args.now.getTime(),
        args.now.getTime(),
      ),
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
          on conflict(id) do update set
            captured_at = excluded.captured_at,
            as_of_date = excluded.as_of_date,
            balance_minor = excluded.balance_minor
        `,
      )
      .bind(
        snapshotId(args.runId, accountId),
        accountId,
        args.runId,
        args.now.getTime(),
        asOfDate,
        balanceMinor,
      ),
  ]);

  return 3;
}

export async function syncPlaidConnection(
  args: PlaidSyncConnectionArgs,
): Promise<PlaidSyncConnectionResult> {
  const now = args.now ?? new Date();
  const connection = await loadProviderConnection(
    args.database,
    args.connectionId,
  );

  if (!connection?.accessToken) {
    throw new Error(
      `Plaid connection ${args.connectionId} is missing an access token.`,
    );
  }

  if (connection.status !== "active") {
    throw new Error(`Plaid connection ${args.connectionId} is not active.`);
  }

  const client = resolvePlaidClient(args);

  if (!client) {
    throw new Error("Plaid client configuration is required.");
  }

  const currentRunId = runId(args.connectionId, now);
  await insertRunningSyncRun({
    connection,
    database: args.database,
    now,
    runId: currentRunId,
  });

  try {
    const accountsResponse = await client.getAccounts({
      accessToken: connection.accessToken,
    });
    let recordsChanged = 0;

    for (const account of accountsResponse.accounts) {
      recordsChanged += await upsertPlaidAccount({
        account,
        connection,
        database: args.database,
        now,
        runId: currentRunId,
      });
    }

    await args.database
      .prepare(
        `
          update households
          set last_synced_at = ?
          where id = ?
        `,
      )
      .bind(now.getTime(), connection.householdId)
      .run();

    await completeSyncRun({
      database: args.database,
      now,
      recordsChanged,
      runId: currentRunId,
    });

    return {
      recordsChanged,
      runId: currentRunId,
      status: "succeeded",
    };
  } catch (error) {
    await failSyncRun({
      database: args.database,
      errorSummary:
        error instanceof Error ? error.message : "Plaid sync failed.",
      runId: currentRunId,
    });
    throw error;
  }
}

export async function syncConfiguredPlaidConnections(
  args: PlaidSyncConfiguredConnectionsArgs,
) {
  const connections = await args.database
    .prepare(
      `
        select id
        from provider_connections
        where provider = ?
          and status = ?
          and access_token is not null
      `,
    )
    .bind("plaid", "active")
    .all<{ id: string }>();

  if (connections.results.length === 0) {
    return [];
  }

  const client = resolvePlaidClient(args);

  if (!client) {
    return [];
  }

  const results = [];

  for (const connection of connections.results) {
    try {
      results.push(
        await syncPlaidConnection({
          client,
          connectionId: connection.id,
          database: args.database,
          now: args.now,
        }),
      );
    } catch (error) {
      console.error("Scheduled Plaid sync failed.", {
        connectionId: connection.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
