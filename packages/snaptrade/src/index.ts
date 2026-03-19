import { Snaptrade } from "snaptrade-typescript-sdk";

export type SnaptradeDataClient = {
  getAllUserHoldings: (args: {
    brokerageAuthorizationId: string;
    userId: string;
    userSecret: string;
  }) => Promise<SnaptradeHoldings[]>;
  listUserAccounts: (args: {
    brokerageAuthorizationId: string;
    userId: string;
    userSecret: string;
  }) => Promise<SnaptradeAccount[]>;
};

export type SnaptradePortalClient = {
  listBrokerageAuthorizations: (args: {
    userId: string;
    userSecret: string;
  }) => Promise<SnaptradeBrokerageAuthorization[]>;
  loginSnapTradeUser: (args: {
    broker?: string;
    connectionPortalVersion?: "v2" | "v3" | "v4";
    connectionType?: "read" | "trade" | "trade-if-available";
    customRedirect?: string;
    immediateRedirect?: boolean;
    reconnect?: string;
    showCloseButton?: boolean;
    userId: string;
    userSecret: string;
  }) => Promise<{
    redirectUri: string;
    sessionId: null | string;
  }>;
  registerSnapTradeUser: (args: { userId: string }) => Promise<{
    userId: string;
    userSecret: string;
  }>;
};

type SnaptradeAccount = {
  balance?: {
    total?: {
      amount?: number | null;
      currency?: null | string;
    } | null;
  };
  brokerage_authorization?: string;
  id: string;
  institution_name: string;
  is_paper?: boolean;
  name: null | string;
  raw_type?: null | string;
};

type SnaptradeHoldings = {
  account?: {
    id?: string;
    institution_name?: string;
    name?: null | string;
  };
  balances?: Array<{
    cash?: number | null;
    currency?: {
      code?: null | string;
    };
  }> | null;
  positions?: Array<{
    average_purchase_price?: number | null;
    cash_equivalent?: boolean | null;
    price?: number | null;
    symbol?: {
      symbol?: {
        description?: null | string;
        id?: string;
        raw_symbol?: string;
        symbol?: string;
        type?: {
          code?: string;
          description?: string;
        };
      };
    };
    units?: number | null;
  }> | null;
};

export type SnaptradeBrokerageAuthorization = {
  brokerage?: {
    display_name?: string;
    name?: string;
    slug?: string;
  };
  disabled?: boolean;
  id?: string;
  name?: string;
  type?: string;
};

type ProviderConnectionRow = {
  accessSecret: null | string;
  externalConnectionId: string;
  householdId: string;
  id: string;
  status: "active" | "disconnected" | "error";
};

type SyncSnaptradeConnectionArgs = {
  client?: SnaptradeDataClient;
  clientFactory?: (config: {
    clientId: string;
    consumerKey: string;
  }) => SnaptradeDataClient;
  clientId?: string;
  connectionId: string;
  consumerKey?: string;
  database: D1Database;
  now?: Date;
};

type SyncSnaptradeConnectionResult = {
  recordsChanged: number;
  runId: string;
  status: "succeeded";
};

function escapeIdentifierSegment(value: string) {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

function providerAccountRowId(connectionId: string, providerAccountId: string) {
  return `provacct:snaptrade:${escapeIdentifierSegment(connectionId)}:${escapeIdentifierSegment(providerAccountId)}`;
}

function canonicalAccountId(connectionId: string, providerAccountId: string) {
  return `acct:snaptrade:${escapeIdentifierSegment(connectionId)}:${escapeIdentifierSegment(providerAccountId)}`;
}

function holdingRowId(accountId: string, holdingKey: string) {
  return `holding:snaptrade:${escapeIdentifierSegment(accountId)}:${escapeIdentifierSegment(holdingKey)}`;
}

function holdingSnapshotId(runId: string, holdingId: string) {
  return `holding_snapshot:${runId}:${escapeIdentifierSegment(holdingId)}`;
}

function balanceSnapshotId(runId: string, accountId: string) {
  return `snapshot:${runId}:${escapeIdentifierSegment(accountId)}`;
}

function checkpointId(connectionId: string) {
  return `checkpoint:${escapeIdentifierSegment(connectionId)}`;
}

function runId(connectionId: string, now: Date) {
  const compactTimestamp = now
    .toISOString()
    .replaceAll(/[-:.]/g, "")
    .replace("Z", "Z");
  return `sync:snaptrade:${escapeIdentifierSegment(connectionId)}:${compactTimestamp}`;
}

function formatAsOfDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDecimal(value: number) {
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function toMinorUnits(value: number) {
  if (!Number.isFinite(value)) {
    throw new Error(`SnapTrade amount ${value} is not a finite number.`);
  }

  return Math.round(value * 100);
}

function inferInvestmentAccountType(account: SnaptradeAccount) {
  const normalized =
    `${account.raw_type ?? ""} ${account.name ?? ""}`.toLowerCase();

  if (
    normalized.includes("ira") ||
    normalized.includes("401") ||
    normalized.includes("403") ||
    normalized.includes("retirement")
  ) {
    return {
      accountSubtype: account.raw_type ?? "retirement",
      accountType: "retirement" as const,
    };
  }

  return {
    accountSubtype: account.raw_type ?? "brokerage",
    accountType: "brokerage" as const,
  };
}

function inferAssetClass(
  position: NonNullable<SnaptradeHoldings["positions"]>[number],
) {
  if (position.cash_equivalent) {
    return "cash" as const;
  }

  const securityType = position.symbol?.symbol?.type?.code?.toLowerCase();

  if (securityType === "crypto") {
    return "crypto" as const;
  }

  if (securityType === "bnd") {
    return "fixed_income" as const;
  }

  if (
    securityType === "oef" ||
    securityType === "cef" ||
    securityType === "pm"
  ) {
    return "fund" as const;
  }

  if (
    securityType === "ad" ||
    securityType === "cs" ||
    securityType === "et" ||
    securityType === "ps" ||
    securityType === "rt" ||
    securityType === "struct" ||
    securityType === "ut" ||
    securityType === "wi" ||
    securityType === "wt"
  ) {
    return "equity" as const;
  }

  return "other" as const;
}

function createSyntheticCashHolding(args: {
  accountId: string;
  accountType: "brokerage" | "retirement";
  cashAmount: number;
  currency: string;
}) {
  const holdingKey = `cash:${args.currency}`;

  return {
    assetClass: "cash" as const,
    costBasisMinor: toMinorUnits(args.cashAmount),
    holdingId: holdingRowId(args.accountId, holdingKey),
    holdingKey,
    marketValueMinor: toMinorUnits(args.cashAmount),
    name: `${args.currency} Cash`,
    priceMinor: 100,
    quantity: formatDecimal(args.cashAmount),
    subAssetClass:
      args.accountType === "retirement" ? "Retirement cash" : "Brokerage cash",
    symbol: args.currency,
  };
}

function createPositionHolding(args: {
  accountId: string;
  position: NonNullable<SnaptradeHoldings["positions"]>[number];
}) {
  const symbol =
    args.position.symbol?.symbol?.symbol ??
    args.position.symbol?.symbol?.raw_symbol ??
    null;
  const universalId = args.position.symbol?.symbol?.id;
  const description =
    args.position.symbol?.symbol?.description ?? symbol ?? "Unnamed holding";
  const price = args.position.price;
  const units = args.position.units;

  if (
    price == null ||
    units == null ||
    !Number.isFinite(price) ||
    !Number.isFinite(units)
  ) {
    return null;
  }

  const marketValue = price * units;

  if (!Number.isFinite(marketValue) || Math.abs(marketValue) < 0.005) {
    return null;
  }

  const holdingKey = universalId
    ? `symbol:${universalId}`
    : symbol
      ? `symbol:${symbol.toLowerCase()}`
      : `name:${description.toLowerCase()}`;

  return {
    assetClass: inferAssetClass(args.position),
    costBasisMinor:
      args.position.average_purchase_price != null
        ? toMinorUnits(args.position.average_purchase_price * units)
        : null,
    holdingId: holdingRowId(args.accountId, holdingKey),
    holdingKey,
    marketValueMinor: toMinorUnits(marketValue),
    name: description,
    priceMinor: toMinorUnits(price),
    quantity: formatDecimal(units),
    subAssetClass: args.position.symbol?.symbol?.type?.description ?? null,
    symbol,
  };
}

export function createSnaptradeDataClient(config: {
  clientId: string;
  consumerKey: string;
}): SnaptradeDataClient {
  const snaptrade = new Snaptrade({
    clientId: config.clientId,
    consumerKey: config.consumerKey,
  });

  return {
    async getAllUserHoldings(args) {
      const response = await snaptrade.accountInformation.getAllUserHoldings({
        brokerageAuthorizations: args.brokerageAuthorizationId,
        userId: args.userId,
        userSecret: args.userSecret,
      });

      return (response.data ?? []) as SnaptradeHoldings[];
    },

    async listUserAccounts(args) {
      const response = await snaptrade.accountInformation.listUserAccounts({
        userId: args.userId,
        userSecret: args.userSecret,
      });

      return ((response.data ?? []) as SnaptradeAccount[]).filter((account) => {
        return (
          account.brokerage_authorization === args.brokerageAuthorizationId
        );
      });
    },
  };
}

export function createSnaptradePortalClient(config: {
  clientId: string;
  consumerKey: string;
}): SnaptradePortalClient {
  const snaptrade = new Snaptrade({
    clientId: config.clientId,
    consumerKey: config.consumerKey,
  });

  return {
    async listBrokerageAuthorizations(args) {
      const response = await snaptrade.connections.listBrokerageAuthorizations({
        userId: args.userId,
        userSecret: args.userSecret,
      });

      return (response.data ?? []) as SnaptradeBrokerageAuthorization[];
    },

    async loginSnapTradeUser(args) {
      const response = await snaptrade.authentication.loginSnapTradeUser({
        broker: args.broker,
        connectionPortalVersion: args.connectionPortalVersion,
        connectionType: args.connectionType,
        customRedirect: args.customRedirect,
        immediateRedirect: args.immediateRedirect,
        reconnect: args.reconnect,
        showCloseButton: args.showCloseButton,
        userId: args.userId,
        userSecret: args.userSecret,
      });
      const loginData = response.data as
        | {
            redirectURI?: string;
            sessionId?: string;
          }
        | undefined;
      const redirectUri =
        typeof loginData?.redirectURI === "string"
          ? loginData.redirectURI
          : null;

      if (!redirectUri) {
        throw new Error(
          "SnapTrade login succeeded but did not return a redirect URI.",
        );
      }

      return {
        redirectUri,
        sessionId:
          typeof loginData?.sessionId === "string" ? loginData.sessionId : null,
      };
    },

    async registerSnapTradeUser(args) {
      const response = await snaptrade.authentication.registerSnapTradeUser({
        userId: args.userId,
      });

      if (
        typeof response.data?.userId !== "string" ||
        typeof response.data?.userSecret !== "string"
      ) {
        throw new Error(
          "SnapTrade registration succeeded but did not return user credentials.",
        );
      }

      return {
        userId: response.data.userId,
        userSecret: response.data.userSecret,
      };
    },
  };
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
          external_connection_id as externalConnectionId,
          access_secret as accessSecret
        from provider_connections
        where id = ? and provider = ?
      `,
    )
    .bind(connectionId, "snaptrade")
    .first<ProviderConnectionRow>();
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
      "snaptrade",
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
  accounts: SnaptradeAccount[];
  completionTime: Date;
  connection: ProviderConnectionRow;
  database: D1Database;
  holdingsByAccountId: Map<string, SnaptradeHoldings>;
  runId: string;
}) {
  const completionTimeMs = args.completionTime.getTime();
  const statements: D1PreparedStatement[] = [];
  let recordsChanged = 0;

  for (const account of args.accounts) {
    const resolvedAccount = inferInvestmentAccountType(account);
    const providerAccountId = providerAccountRowId(
      args.connection.id,
      account.id,
    );
    const accountId = canonicalAccountId(args.connection.id, account.id);
    const balanceMinor = toMinorUnits(account.balance?.total?.amount ?? 0);
    const currency = account.balance?.total?.currency ?? "USD";

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
          account.name ?? "Unnamed investment account",
          account.institution_name,
          resolvedAccount.accountType,
          resolvedAccount.accountSubtype,
          currency,
          completionTimeMs,
          completionTimeMs,
        ),
    );
    recordsChanged += 1;

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
          account.name ?? "Unnamed investment account",
          account.institution_name,
          resolvedAccount.accountType,
          resolvedAccount.accountSubtype,
          currency,
          "joint",
          1,
          0,
          "investments",
          balanceMinor,
          completionTimeMs,
          completionTimeMs,
        ),
    );
    recordsChanged += 1;

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
          balanceSnapshotId(args.runId, accountId),
          accountId,
          args.runId,
          completionTimeMs,
          formatAsOfDate(args.completionTime),
          balanceMinor,
        ),
    );
    recordsChanged += 1;

    const holdingsData = args.holdingsByAccountId.get(account.id);
    const normalizedHoldings = [
      ...(holdingsData?.balances ?? []).flatMap((balance) => {
        const cashAmount = balance.cash ?? 0;

        if (!Number.isFinite(cashAmount) || Math.abs(cashAmount) < 0.005) {
          return [];
        }

        return [
          createSyntheticCashHolding({
            accountId,
            accountType: resolvedAccount.accountType,
            cashAmount,
            currency: balance.currency?.code ?? currency,
          }),
        ];
      }),
      ...(holdingsData?.positions ?? []).flatMap((position) => {
        const normalizedPosition = createPositionHolding({
          accountId,
          position,
        });

        return normalizedPosition ? [normalizedPosition] : [];
      }),
    ];

    for (const holding of normalizedHoldings) {
      statements.push(
        args.database
          .prepare(
            `
              insert into holdings (
                id,
                account_id,
                holding_key,
                symbol,
                name,
                asset_class,
                sub_asset_class,
                currency,
                created_at,
                updated_at
              )
              values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              on conflict(id) do update set
                symbol = excluded.symbol,
                name = excluded.name,
                asset_class = excluded.asset_class,
                sub_asset_class = excluded.sub_asset_class,
                currency = excluded.currency,
                updated_at = excluded.updated_at
            `,
          )
          .bind(
            holding.holdingId,
            accountId,
            holding.holdingKey,
            holding.symbol,
            holding.name,
            holding.assetClass,
            holding.subAssetClass,
            currency,
            completionTimeMs,
            completionTimeMs,
          ),
      );
      recordsChanged += 1;

      statements.push(
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
            `,
          )
          .bind(
            holdingSnapshotId(args.runId, holding.holdingId),
            holding.holdingId,
            accountId,
            args.runId,
            completionTimeMs,
            formatAsOfDate(args.completionTime),
            holding.quantity,
            holding.priceMinor,
            holding.marketValueMinor,
            holding.costBasisMinor,
          ),
      );
      recordsChanged += 1;
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
        args.completionTime.toISOString(),
        completionTimeMs,
      ),
  );
  statements.push(
    args.database
      .prepare(
        `
          update sync_runs
          set status = ?, completed_at = ?, records_changed = ?, error_summary = ?
          where id = ?
        `,
      )
      .bind("succeeded", completionTimeMs, recordsChanged, null, args.runId),
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

export async function syncSnaptradeConnection(
  args: SyncSnaptradeConnectionArgs,
): Promise<SyncSnaptradeConnectionResult> {
  const now = args.now ?? new Date();
  const connection = await loadProviderConnection(
    args.database,
    args.connectionId,
  );

  if (!connection) {
    throw new Error(
      `SnapTrade connection ${args.connectionId} could not be found.`,
    );
  }

  if (connection.status !== "active") {
    throw new Error(`SnapTrade connection ${args.connectionId} is not active.`);
  }

  if (!connection.accessSecret) {
    throw new Error(
      `SnapTrade connection ${args.connectionId} is missing a stored user secret.`,
    );
  }

  if (!connection.externalConnectionId) {
    throw new Error(
      `SnapTrade connection ${args.connectionId} is missing a brokerage authorization id.`,
    );
  }

  const resolvedClient =
    args.client ??
    (args.clientId && args.consumerKey
      ? (args.clientFactory ?? createSnaptradeDataClient)({
          clientId: args.clientId,
          consumerKey: args.consumerKey,
        })
      : null);

  if (!resolvedClient) {
    throw new Error("SnapTrade client configuration is required.");
  }

  const currentRunId = runId(connection.id, now);
  await insertRunningSyncRun({
    connection,
    database: args.database,
    now,
    runId: currentRunId,
  });

  try {
    const userId = connection.householdId;
    const [accounts, holdings] = await Promise.all([
      resolvedClient.listUserAccounts({
        brokerageAuthorizationId: connection.externalConnectionId,
        userId,
        userSecret: connection.accessSecret,
      }),
      resolvedClient.getAllUserHoldings({
        brokerageAuthorizationId: connection.externalConnectionId,
        userId,
        userSecret: connection.accessSecret,
      }),
    ]);

    const holdingsByAccountId = new Map<string, SnaptradeHoldings>();

    for (const holdingSet of holdings) {
      const accountId = holdingSet.account?.id;

      if (accountId) {
        holdingsByAccountId.set(accountId, holdingSet);
      }
    }

    const recordsChanged = await finalizeSuccessfulSync({
      accounts,
      completionTime: now,
      connection,
      database: args.database,
      holdingsByAccountId,
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
        : `SnapTrade sync failed for connection ${args.connectionId}.`;

    await markSyncRunFailed({
      database: args.database,
      errorSummary: reason,
      failedAt: now,
      runId: currentRunId,
    });
    throw new Error(reason);
  }
}

export async function syncConfiguredSnaptradeConnections(args: {
  client?: SnaptradeDataClient;
  clientFactory?: (config: {
    clientId: string;
    consumerKey: string;
  }) => SnaptradeDataClient;
  clientId?: string;
  consumerKey?: string;
  database: D1Database;
  now?: Date;
}) {
  const connections = await args.database
    .prepare(
      `
        select id
        from provider_connections
        where provider = ?
          and status = ?
          and access_secret is not null
      `,
    )
    .bind("snaptrade", "active")
    .all<{ id: string }>();

  if (connections.results.length === 0) {
    return [];
  }

  const resolvedClient =
    args.client ??
    (args.clientId && args.consumerKey
      ? (args.clientFactory ?? createSnaptradeDataClient)({
          clientId: args.clientId,
          consumerKey: args.consumerKey,
        })
      : null);

  if (!resolvedClient) {
    return [];
  }

  const results = [];

  for (const connection of connections.results) {
    results.push(
      await syncSnaptradeConnection({
        client: resolvedClient,
        connectionId: connection.id,
        database: args.database,
        now: args.now,
      }),
    );
  }

  return results;
}
