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

type PlaidApiHolding = {
  account_id: string;
  cost_basis?: null | number;
  institution_price: number;
  institution_price_as_of?: null | string;
  institution_price_datetime?: null | string;
  institution_value: number;
  iso_currency_code?: null | string;
  quantity: number;
  security_id: string;
  unofficial_currency_code?: null | string;
};

type PlaidApiInvestmentTransaction = {
  account_id: string;
  amount: number;
  date: string;
  fees?: null | number;
  investment_transaction_id: string;
  iso_currency_code?: null | string;
  name: string;
  price?: null | number;
  quantity: number;
  security_id?: null | string;
  subtype?: null | string;
  transaction_datetime?: null | string;
  type: string;
  unofficial_currency_code?: null | string;
};

type PlaidApiSecurity = {
  close_price?: null | number;
  close_price_as_of?: null | string;
  institution_id?: null | string;
  institution_security_id?: null | string;
  is_cash_equivalent?: null | boolean;
  iso_currency_code?: null | string;
  name?: null | string;
  security_id: string;
  subtype?: null | string;
  ticker_symbol?: null | string;
  type?: null | string;
  unofficial_currency_code?: null | string;
  update_datetime?: null | string;
};

type PlaidApiTransaction = {
  account_id: string;
  amount: number;
  authorized_date?: null | string;
  date: string;
  merchant_name?: null | string;
  name: string;
  pending?: boolean;
  personal_finance_category?: {
    detailed?: null | string;
    primary?: null | string;
  };
  transaction_id: string;
};

type PlaidApiRemovedTransaction = {
  transaction_id: string;
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
    transactionsDaysRequested?: number;
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
  getInvestmentsHoldings(args: { accessToken: string }): Promise<{
    accounts: PlaidApiAccount[];
    holdings: PlaidApiHolding[];
    securities: PlaidApiSecurity[];
  }>;
  getInvestmentsTransactions?(args: {
    accessToken: string;
    endDate: string;
    startDate: string;
  }): Promise<{
    investmentTransactions: PlaidApiInvestmentTransaction[];
  }>;
  getTransactionsSync?(args: {
    accessToken: string;
    cursor?: null | string;
  }): Promise<{
    accounts: PlaidApiAccount[];
    added: PlaidApiTransaction[];
    hasMore: boolean;
    modified: PlaidApiTransaction[];
    nextCursor: string;
    removed: PlaidApiRemovedTransaction[];
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

function transactionId(accountId: string, providerTransactionId: string) {
  return `txn:plaid:${escapeIdentifierSegment(accountId)}:${escapeIdentifierSegment(providerTransactionId)}`;
}

function holdingId(
  connectionId: string,
  providerAccountId: string,
  securityId: string,
) {
  return `holding:plaid:${escapeIdentifierSegment(connectionId)}:${escapeIdentifierSegment(providerAccountId)}:${escapeIdentifierSegment(securityId)}`;
}

function investmentTransactionId(
  accountId: string,
  providerTransactionId: string,
) {
  return `invtxn:plaid:${escapeIdentifierSegment(accountId)}:${escapeIdentifierSegment(providerTransactionId)}`;
}

function canonicalSecurityId(providerSecurityId: string) {
  return `security:plaid:${escapeIdentifierSegment(providerSecurityId)}`;
}

function holdingSnapshotId(runIdValue: string, holdingIdValue: string) {
  return `holding_snapshot:${runIdValue}:${escapeIdentifierSegment(holdingIdValue)}`;
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

function normalizeTransactionDirection(amount: number) {
  return amount < 0 ? ("credit" as const) : ("debit" as const);
}

function parsePostedAt(value: string) {
  const parsedTimestamp = Date.parse(value);

  return Number.isNaN(parsedTimestamp) ? Date.now() : parsedTimestamp;
}

function normalizeTransactionCategory(transaction: PlaidApiTransaction) {
  return (
    transaction.personal_finance_category?.detailed?.trim() ||
    transaction.personal_finance_category?.primary?.trim() ||
    null
  );
}

function normalizeInvestmentTransactionCurrency(
  transaction: PlaidApiInvestmentTransaction,
) {
  return (
    transaction.iso_currency_code ??
    transaction.unofficial_currency_code ??
    "USD"
  );
}

function normalizeCurrency(account: PlaidApiAccount) {
  return (
    account.balances.iso_currency_code ??
    account.balances.unofficial_currency_code ??
    "USD"
  );
}

function normalizeHoldingCurrency(
  holding: PlaidApiHolding,
  security?: PlaidApiSecurity,
) {
  return (
    holding.iso_currency_code ??
    holding.unofficial_currency_code ??
    security?.iso_currency_code ??
    security?.unofficial_currency_code ??
    "USD"
  );
}

function normalizeInstitutionName(connection: PlaidConnectionRow) {
  return connection.institutionName?.trim() || "Plaid";
}

function normalizeHoldingAssetClass(security?: PlaidApiSecurity) {
  const securityType = security?.type?.trim().toLowerCase();

  if (security?.is_cash_equivalent || securityType === "cash") {
    return "cash" as const;
  }

  if (securityType === "cryptocurrency") {
    return "crypto" as const;
  }

  if (securityType === "equity") {
    return "equity" as const;
  }

  if (securityType === "fixed income") {
    return "fixed_income" as const;
  }

  if (securityType === "etf" || securityType === "mutual fund") {
    return "fund" as const;
  }

  return "other" as const;
}

function normalizeHoldingName(
  holding: PlaidApiHolding,
  security?: PlaidApiSecurity,
) {
  const securityName = security?.name?.trim();

  if (securityName) {
    return securityName;
  }

  const tickerSymbol = security?.ticker_symbol?.trim();

  if (tickerSymbol) {
    return tickerSymbol;
  }

  return holding.security_id;
}

function normalizeHoldingQuantity(value: number) {
  return Number.isFinite(value) ? value.toString() : "0";
}

function normalizeSecurityType(security?: PlaidApiSecurity) {
  return security?.type?.trim().toLowerCase() || null;
}

function normalizeSecuritySubtype(security?: PlaidApiSecurity) {
  return security?.subtype?.trim().toLowerCase() || null;
}

function parseCapturedAt(
  value: null | string | undefined,
  fallbackTimestamp: number,
) {
  if (!value) {
    return fallbackTimestamp;
  }

  const parsedTimestamp = Date.parse(value);

  return Number.isNaN(parsedTimestamp) ? fallbackTimestamp : parsedTimestamp;
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
          transactions: args.transactionsDaysRequested
            ? {
                days_requested: args.transactionsDaysRequested,
              }
            : undefined,
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

    async getInvestmentsHoldings(args) {
      const response = await requestPlaid<{
        accounts: PlaidApiAccount[];
        holdings: PlaidApiHolding[];
        securities: PlaidApiSecurity[];
      }>({
        baseUrl,
        body: {
          access_token: args.accessToken,
        },
        clientId: config.clientId,
        fetchImpl,
        path: "/investments/holdings/get",
        secret: config.secret,
      });

      return {
        accounts: response.accounts ?? [],
        holdings: response.holdings ?? [],
        securities: response.securities ?? [],
      };
    },

    async getInvestmentsTransactions(args) {
      const investmentTransactions: PlaidApiInvestmentTransaction[] = [];
      let offset = 0;
      let totalInvestmentTransactions = 0;

      do {
        const response = await requestPlaid<{
          investment_transactions: PlaidApiInvestmentTransaction[];
          total_investment_transactions: number;
        }>({
          baseUrl,
          body: {
            access_token: args.accessToken,
            end_date: args.endDate,
            options: {
              count: 500,
              offset,
            },
            start_date: args.startDate,
          },
          clientId: config.clientId,
          fetchImpl,
          path: "/investments/transactions/get",
          secret: config.secret,
        });

        const page = response.investment_transactions ?? [];
        investmentTransactions.push(...page);
        totalInvestmentTransactions =
          response.total_investment_transactions ?? 0;
        offset += page.length;
      } while (investmentTransactions.length < totalInvestmentTransactions);

      return {
        investmentTransactions,
      };
    },

    async getTransactionsSync(args) {
      const response = await requestPlaid<{
        accounts: PlaidApiAccount[];
        added: PlaidApiTransaction[];
        has_more: boolean;
        modified: PlaidApiTransaction[];
        next_cursor: string;
        removed: PlaidApiRemovedTransaction[];
      }>({
        baseUrl,
        body: {
          access_token: args.accessToken,
          count: 500,
          cursor: args.cursor ?? undefined,
        },
        clientId: config.clientId,
        fetchImpl,
        path: "/transactions/sync",
        secret: config.secret,
      });

      return {
        accounts: response.accounts ?? [],
        added: response.added ?? [],
        hasMore: response.has_more ?? false,
        modified: response.modified ?? [],
        nextCursor: response.next_cursor,
        removed: response.removed ?? [],
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

async function loadSyncCheckpoint(database: D1Database, connectionId: string) {
  return database
    .prepare(
      `
        select cursor
        from sync_checkpoints
        where provider_connection_id = ?
      `,
    )
    .bind(connectionId)
    .first<{ cursor: string }>();
}

async function saveSyncCheckpoint(args: {
  connectionId: string;
  cursor: string;
  database: D1Database;
  now: Date;
}) {
  await args.database
    .prepare(
      `
        insert into sync_checkpoints (
          provider_connection_id,
          cursor,
          updated_at
        )
        values (?, ?, ?)
        on conflict(provider_connection_id) do update set
          cursor = excluded.cursor,
          updated_at = excluded.updated_at
      `,
    )
    .bind(args.connectionId, args.cursor, args.now.getTime())
    .run();
}

async function upsertPlaidTransaction(args: {
  connectionId: string;
  database: D1Database;
  now: Date;
  runId: string;
  transaction: PlaidApiTransaction;
}) {
  const accountId = canonicalAccountId(
    args.connectionId,
    args.transaction.account_id,
  );
  const category = normalizeTransactionCategory(args.transaction);

  await args.database
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
          category_normalized = excluded.category_normalized,
          source_sync_run_id = excluded.source_sync_run_id
      `,
    )
    .bind(
      transactionId(accountId, args.transaction.transaction_id),
      accountId,
      args.transaction.transaction_id,
      parsePostedAt(args.transaction.date),
      toMinorUnits(Math.abs(args.transaction.amount)),
      normalizeTransactionDirection(args.transaction.amount),
      args.transaction.name.trim() || args.transaction.transaction_id,
      args.transaction.merchant_name?.trim() || null,
      category,
      category,
      0,
      args.runId,
    )
    .run();

  return 1;
}

async function removePlaidTransaction(args: {
  connectionId: string;
  database: D1Database;
  providerTransactionId: string;
}) {
  await args.database
    .prepare(
      `
        delete from transactions
        where provider_transaction_id = ?
          and account_id in (
            select accounts.id
            from accounts
            join provider_accounts
              on accounts.provider_account_id = provider_accounts.id
            where provider_accounts.provider_connection_id = ?
          )
      `,
    )
    .bind(args.providerTransactionId, args.connectionId)
    .run();

  return 1;
}

async function upsertPlaidInvestmentTransaction(args: {
  connectionId: string;
  database: D1Database;
  now?: Date;
  runId: string;
  transaction: PlaidApiInvestmentTransaction;
}) {
  const accountId = canonicalAccountId(
    args.connectionId,
    args.transaction.account_id,
  );
  const postedAt = parsePostedAt(args.transaction.date);
  const normalizedSecurityId = args.transaction.security_id?.trim()
    ? canonicalSecurityId(args.transaction.security_id.trim())
    : null;

  if (normalizedSecurityId) {
    await args.database
      .prepare(
        `
          insert or ignore into securities (
            id,
            provider,
            provider_security_id,
            symbol,
            name,
            security_type,
            security_subtype,
            currency,
            price_source,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        normalizedSecurityId,
        "plaid",
        args.transaction.security_id?.trim() ?? normalizedSecurityId,
        null,
        args.transaction.name.trim() ||
          args.transaction.investment_transaction_id,
        null,
        null,
        normalizeInvestmentTransactionCurrency(args.transaction),
        "alpha_vantage",
        args.now?.getTime() ?? postedAt,
        args.now?.getTime() ?? postedAt,
      )
      .run();
  }

  await args.database
    .prepare(
      `
        insert into investment_transactions (
          id,
          account_id,
          provider_transaction_id,
          posted_at,
          trade_at,
          amount_minor,
          price_minor,
          fees_minor,
          quantity,
          name,
          security_id,
          type,
          subtype,
          currency,
          source_sync_run_id
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(account_id, provider_transaction_id) do update set
          posted_at = excluded.posted_at,
          trade_at = excluded.trade_at,
          amount_minor = excluded.amount_minor,
          price_minor = excluded.price_minor,
          fees_minor = excluded.fees_minor,
          quantity = excluded.quantity,
          name = excluded.name,
          security_id = excluded.security_id,
          type = excluded.type,
          subtype = excluded.subtype,
          currency = excluded.currency,
          source_sync_run_id = excluded.source_sync_run_id
      `,
    )
    .bind(
      investmentTransactionId(
        accountId,
        args.transaction.investment_transaction_id,
      ),
      accountId,
      args.transaction.investment_transaction_id,
      postedAt,
      args.transaction.transaction_datetime
        ? parseCapturedAt(args.transaction.transaction_datetime, postedAt)
        : null,
      toMinorUnits(Math.abs(args.transaction.amount)),
      args.transaction.price === null || args.transaction.price === undefined
        ? null
        : toMinorUnits(args.transaction.price),
      args.transaction.fees === null || args.transaction.fees === undefined
        ? null
        : toMinorUnits(args.transaction.fees),
      normalizeHoldingQuantity(args.transaction.quantity),
      args.transaction.name.trim() ||
        args.transaction.investment_transaction_id,
      normalizedSecurityId,
      args.transaction.type.trim(),
      args.transaction.subtype?.trim() || null,
      normalizeInvestmentTransactionCurrency(args.transaction),
      args.runId,
    )
    .run();

  return 1;
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

async function upsertPlaidHolding(args: {
  accountId: string;
  connectionId: string;
  database: D1Database;
  holding: PlaidApiHolding;
  now: Date;
  runId: string;
  security?: PlaidApiSecurity;
}) {
  const normalizedHoldingId = holdingId(
    args.connectionId,
    args.holding.account_id,
    args.holding.security_id,
  );
  const normalizedSecurityId = canonicalSecurityId(args.holding.security_id);
  const timestamp = args.now.getTime();
  const securityType = normalizeSecurityType(args.security);
  const securitySubtype = normalizeSecuritySubtype(args.security);
  const symbol = args.security?.ticker_symbol?.trim() || null;
  const priceDate =
    args.holding.institution_price_as_of?.trim() ||
    args.now.toISOString().slice(0, 10);

  await args.database.batch([
    args.database
      .prepare(
        `
          insert into securities (
            id,
            provider,
            provider_security_id,
            symbol,
            name,
            security_type,
            security_subtype,
            currency,
            price_source,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(id) do update set
            symbol = excluded.symbol,
            name = excluded.name,
            security_type = excluded.security_type,
            security_subtype = excluded.security_subtype,
            currency = excluded.currency,
            price_source = excluded.price_source,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        normalizedSecurityId,
        "plaid",
        args.holding.security_id,
        symbol,
        normalizeHoldingName(args.holding, args.security),
        securityType,
        securitySubtype,
        normalizeHoldingCurrency(args.holding, args.security),
        "alpha_vantage",
        timestamp,
        timestamp,
      ),
    args.database
      .prepare(
        `
          insert into holdings (
            id,
            account_id,
            holding_key,
            symbol,
            name,
            security_id,
            asset_class,
            sub_asset_class,
            currency,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(id) do update set
            symbol = excluded.symbol,
            name = excluded.name,
            security_id = excluded.security_id,
            asset_class = excluded.asset_class,
            sub_asset_class = excluded.sub_asset_class,
            currency = excluded.currency,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        normalizedHoldingId,
        args.accountId,
        `security:${args.holding.security_id}`,
        symbol,
        normalizeHoldingName(args.holding, args.security),
        normalizedSecurityId,
        normalizeHoldingAssetClass(args.security),
        [securityType, securitySubtype].filter(Boolean).join(":") || null,
        normalizeHoldingCurrency(args.holding, args.security),
        timestamp,
        timestamp,
      ),
    args.database
      .prepare(
        `
          insert into security_price_daily (
            security_id,
            price_date,
            close_price_minor,
            currency,
            source,
            is_estimated,
            fetched_at
          )
          values (?, ?, ?, ?, ?, ?, ?)
          on conflict(security_id, price_date) do update set
            close_price_minor = excluded.close_price_minor,
            currency = excluded.currency,
            source = excluded.source,
            is_estimated = excluded.is_estimated,
            fetched_at = excluded.fetched_at
        `,
      )
      .bind(
        normalizedSecurityId,
        priceDate,
        toMinorUnits(args.holding.institution_price),
        normalizeHoldingCurrency(args.holding, args.security),
        "plaid_holdings",
        0,
        timestamp,
      ),
    args.database
      .prepare(
        `
          insert into holding_snapshots (
            id,
            holding_id,
            account_id,
            source_sync_run_id,
            captured_at,
            as_of_date,
            quantity,
            price_minor,
            market_value_minor,
            cost_basis_minor
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(id) do update set
            captured_at = excluded.captured_at,
            as_of_date = excluded.as_of_date,
            quantity = excluded.quantity,
            price_minor = excluded.price_minor,
            market_value_minor = excluded.market_value_minor,
            cost_basis_minor = excluded.cost_basis_minor
        `,
      )
      .bind(
        holdingSnapshotId(args.runId, normalizedHoldingId),
        normalizedHoldingId,
        args.accountId,
        args.runId,
        parseCapturedAt(
          args.holding.institution_price_datetime,
          args.now.getTime(),
        ),
        args.now.toISOString().slice(0, 10),
        normalizeHoldingQuantity(args.holding.quantity),
        toMinorUnits(args.holding.institution_price),
        toMinorUnits(args.holding.institution_value),
        args.holding.cost_basis === null ||
          args.holding.cost_basis === undefined
          ? null
          : toMinorUnits(args.holding.cost_basis),
      ),
  ]);

  return 2;
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
    const investmentAccounts = accountsResponse.accounts.filter(
      (account) => account.type === "investment",
    );
    const holdingsResponse =
      investmentAccounts.length > 0
        ? await client.getInvestmentsHoldings({
            accessToken: connection.accessToken,
          })
        : { accounts: [], holdings: [], securities: [] };
    const securitiesById = new Map(
      holdingsResponse.securities.map((security) => [
        security.security_id,
        security,
      ]),
    );
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

    for (const holding of holdingsResponse.holdings) {
      recordsChanged += await upsertPlaidHolding({
        accountId: canonicalAccountId(connection.id, holding.account_id),
        connectionId: connection.id,
        database: args.database,
        holding,
        now,
        runId: currentRunId,
        security: securitiesById.get(holding.security_id),
      });
    }

    if (client.getTransactionsSync) {
      let cursor =
        (await loadSyncCheckpoint(args.database, connection.id))?.cursor ??
        null;
      let hasMore = false;

      do {
        const transactionsResponse = await client.getTransactionsSync({
          accessToken: connection.accessToken,
          cursor,
        });

        for (const transaction of [
          ...transactionsResponse.added,
          ...transactionsResponse.modified,
        ]) {
          recordsChanged += await upsertPlaidTransaction({
            connectionId: connection.id,
            database: args.database,
            now,
            runId: currentRunId,
            transaction,
          });
        }

        for (const removedTransaction of transactionsResponse.removed) {
          recordsChanged += await removePlaidTransaction({
            connectionId: connection.id,
            database: args.database,
            providerTransactionId: removedTransaction.transaction_id,
          });
        }

        cursor = transactionsResponse.nextCursor;
        hasMore = transactionsResponse.hasMore;
      } while (hasMore);

      if (cursor) {
        await saveSyncCheckpoint({
          connectionId: connection.id,
          cursor,
          database: args.database,
          now,
        });
      }
    }

    if (client.getInvestmentsTransactions && investmentAccounts.length > 0) {
      const endDate = now.toISOString().slice(0, 10);
      const startDateValue = new Date(now);
      startDateValue.setUTCDate(startDateValue.getUTCDate() - 730);
      const startDate = startDateValue.toISOString().slice(0, 10);
      const investmentTransactionsResponse =
        await client.getInvestmentsTransactions({
          accessToken: connection.accessToken,
          endDate,
          startDate,
        });

      for (const transaction of investmentTransactionsResponse.investmentTransactions) {
        recordsChanged += await upsertPlaidInvestmentTransaction({
          connectionId: connection.id,
          database: args.database,
          now,
          runId: currentRunId,
          transaction,
        });
      }
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
