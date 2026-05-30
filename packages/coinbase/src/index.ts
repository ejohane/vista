import { createPrivateKey, randomBytes, sign } from "node:crypto";

import { decryptProviderToken } from "@vista/plaid";

type CoinbaseFetch = typeof fetch;

type CoinbaseMoney = {
  currency: string;
  value: string;
};

type CoinbaseApiAccount = {
  active?: boolean;
  available_balance: CoinbaseMoney;
  deleted_at?: null | string;
  hold?: CoinbaseMoney;
  name: string;
  ready?: boolean;
  retail_portfolio_id?: null | string;
  type?: string;
  updated_at?: null | string;
  uuid: string;
};

type CoinbaseApiProduct = {
  base_currency_id?: string;
  base_name?: string;
  price?: string;
  product_id: string;
};

type CoinbaseConnectionRow = {
  accessSecret: null | string;
  accessSecretEncrypted: null | string;
  accessToken: null | string;
  accessTokenEncrypted: null | string;
  credentialKeyVersion: null | number;
  householdId: string;
  id: string;
  status: "active" | "disconnected" | "error";
};

type CoinbaseClientConfig = {
  apiKeyName: string;
  baseUrl?: string;
  privateKey: string;
};

type CoinbaseSyncConnectionArgs = {
  client?: CoinbaseClient;
  clientFactory?: (config: CoinbaseClientConfig) => CoinbaseClient;
  connectionId: string;
  database: D1Database;
  now?: Date;
  providerTokenEncryptionKey?: string;
};

type CoinbaseSyncConfiguredConnectionsArgs = {
  client?: CoinbaseClient;
  clientFactory?: (config: CoinbaseClientConfig) => CoinbaseClient;
  database: D1Database;
  now?: Date;
  providerTokenEncryptionKey?: string;
};

type CoinbaseSyncConnectionResult = {
  recordsChanged: number;
  runId: string;
  status: "succeeded";
};

export type CoinbaseClient = {
  getAccounts(): Promise<{ accounts: CoinbaseApiAccount[] }>;
  getProduct(productId: string): Promise<CoinbaseApiProduct | null>;
};

function encodeBase64Url(value: Buffer | string) {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function normalizePrivateKey(value: string) {
  return value.includes("\\n") ? value.replaceAll("\\n", "\n") : value;
}

function decodeBase64(value: string) {
  return Buffer.from(value.replaceAll(/\s/g, ""), "base64");
}

function createEd25519PrivateKeyFromRawSecret(secret: string) {
  const decoded = decodeBase64(secret);

  if (decoded.byteLength !== 32 && decoded.byteLength !== 64) {
    throw new Error(
      `Ed25519 raw key must decode to 32 or 64 bytes, got ${decoded.byteLength}.`,
    );
  }

  const seed = decoded.subarray(0, 32);
  const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");

  return createPrivateKey({
    format: "der",
    key: Buffer.concat([pkcs8Prefix, seed]),
    type: "pkcs8",
  });
}

function loadCoinbasePrivateKey(secret: string) {
  const normalized = normalizePrivateKey(secret).trim();

  if (normalized.startsWith("-----BEGIN")) {
    return createPrivateKey(normalized);
  }

  return createEd25519PrivateKeyFromRawSecret(normalized);
}

export function createCoinbaseJwt(args: {
  apiKeyName: string;
  method: string;
  path: string;
  privateKey: string;
  now?: Date;
}) {
  const timestamp = Math.floor((args.now?.getTime() ?? Date.now()) / 1000);
  const privateKey = loadCoinbasePrivateKey(args.privateKey);
  const algorithm =
    privateKey.asymmetricKeyType === "ed25519" ? "EdDSA" : "ES256";
  const header = {
    alg: algorithm,
    kid: args.apiKeyName,
    nonce: randomBytes(16).toString("hex"),
    typ: "JWT",
  };
  const payload = {
    exp: timestamp + 120,
    iss: "cdp",
    nbf: timestamp,
    sub: args.apiKeyName,
    uri: `${args.method.toUpperCase()} api.coinbase.com${args.path}`,
  };
  const signingInput = `${encodeBase64Url(JSON.stringify(header))}.${encodeBase64Url(
    JSON.stringify(payload),
  )}`;
  const signature =
    algorithm === "EdDSA"
      ? sign(null, Buffer.from(signingInput), privateKey)
      : sign("sha256", Buffer.from(signingInput), {
          dsaEncoding: "ieee-p1363",
          key: privateKey,
        });

  return `${signingInput}.${encodeBase64Url(signature)}`;
}

function escapeIdentifierSegment(value: string) {
  return value.replaceAll(":", "_");
}

function providerAccountRowId(connectionId: string) {
  return `provacct:coinbase:${escapeIdentifierSegment(connectionId)}:spot`;
}

function canonicalAccountId(connectionId: string) {
  return `acct:coinbase:${escapeIdentifierSegment(connectionId)}:spot`;
}

function holdingId(connectionId: string, currency: string) {
  return `holding:coinbase:${escapeIdentifierSegment(connectionId)}:${escapeIdentifierSegment(currency)}`;
}

function holdingSnapshotId(runIdValue: string, holdingIdValue: string) {
  return `holding_snapshot:${runIdValue}:${escapeIdentifierSegment(holdingIdValue)}`;
}

function runId(connectionId: string, now: Date) {
  const compactTimestamp = now
    .toISOString()
    .replaceAll(/[-:.]/g, "")
    .replace("Z", "Z");
  return `sync:coinbase:${escapeIdentifierSegment(connectionId)}:${compactTimestamp}`;
}

function securityId(currency: string) {
  return `security:coinbase:${escapeIdentifierSegment(currency)}`;
}

function snapshotId(runIdValue: string, accountId: string) {
  return `snapshot:${runIdValue}:${accountId}`;
}

function parseDecimalToScaledBigInt(value: string, scale: number) {
  const normalized = value.trim();
  const match = /^(?<sign>-)?(?<whole>\d+)(?:\.(?<fraction>\d+))?$/.exec(
    normalized,
  );

  if (!match?.groups) {
    return 0n;
  }

  const signMultiplier = match.groups.sign ? -1n : 1n;
  const whole = BigInt(match.groups.whole);
  const fraction = match.groups.fraction ?? "";
  const paddedFraction = `${fraction}${"0".repeat(scale + 1)}`;
  const scaledFraction = BigInt(paddedFraction.slice(0, scale));
  const roundingDigit = Number(paddedFraction.at(scale) ?? "0");
  const scaled = whole * 10n ** BigInt(scale) + scaledFraction;

  return signMultiplier * (roundingDigit >= 5 ? scaled + 1n : scaled);
}

function roundDiv(numerator: bigint, denominator: bigint) {
  if (denominator === 0n) {
    return 0n;
  }

  return (numerator + denominator / 2n) / denominator;
}

function bigIntToSafeNumber(value: bigint) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number.MAX_SAFE_INTEGER;
  }

  if (value < BigInt(Number.MIN_SAFE_INTEGER)) {
    return Number.MIN_SAFE_INTEGER;
  }

  return Number(value);
}

function decimalToMinorUnits(value: string) {
  return bigIntToSafeNumber(parseDecimalToScaledBigInt(value, 2));
}

function marketValueMinor(quantity: string, price: string) {
  const quantityScale = 12;
  const priceScale = 8;
  const quantityUnits = parseDecimalToScaledBigInt(quantity, quantityScale);
  const priceUnits = parseDecimalToScaledBigInt(price, priceScale);
  const denominator = 10n ** BigInt(quantityScale + priceScale);

  return bigIntToSafeNumber(
    roundDiv(quantityUnits * priceUnits * 100n, denominator),
  );
}

function normalizeQuantity(account: CoinbaseApiAccount) {
  return account.available_balance.value.trim() || "0";
}

function normalizeCurrency(account: CoinbaseApiAccount) {
  return account.available_balance.currency.trim().toUpperCase();
}

function productId(currency: string) {
  return `${currency.toUpperCase()}-USD`;
}

function isFiatAccount(account: CoinbaseApiAccount) {
  return account.type?.toUpperCase() === "FIAT";
}

function hasNonZeroQuantity(account: CoinbaseApiAccount) {
  return parseDecimalToScaledBigInt(normalizeQuantity(account), 12) !== 0n;
}

async function requestCoinbase<T>(args: {
  apiKeyName: string;
  baseUrl: string;
  fetchImpl: CoinbaseFetch;
  method: "GET";
  path: string;
  privateKey: string;
  query?: URLSearchParams;
}) {
  const jwt = createCoinbaseJwt({
    apiKeyName: args.apiKeyName,
    method: args.method,
    path: args.path,
    privateKey: args.privateKey,
  });
  const url = new URL(`${args.baseUrl}${args.path}`);

  if (args.query) {
    url.search = args.query.toString();
  }

  const response = await args.fetchImpl(url, {
    headers: {
      authorization: `Bearer ${jwt}`,
    },
    method: args.method,
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Coinbase ${args.path} returned ${response.status}.`);
  }

  return (await response.json()) as T;
}

export function createCoinbaseClient(
  config: CoinbaseClientConfig,
  fetchImpl: CoinbaseFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    globalThis.fetch(input, init)) as CoinbaseFetch,
): CoinbaseClient {
  const baseUrl = config.baseUrl ?? "https://api.coinbase.com";
  const apiKeyName = config.apiKeyName;
  const privateKey = normalizePrivateKey(config.privateKey);

  return {
    async getAccounts() {
      const accounts: CoinbaseApiAccount[] = [];
      let cursor: string | null = null;
      let hasNext = false;

      do {
        const query = new URLSearchParams({ limit: "250" });

        if (cursor) {
          query.set("cursor", cursor);
        }

        const response = await requestCoinbase<{
          accounts?: CoinbaseApiAccount[];
          cursor?: string;
          has_next?: boolean;
        }>({
          apiKeyName,
          baseUrl,
          fetchImpl,
          method: "GET",
          path: "/api/v3/brokerage/accounts",
          privateKey,
          query,
        });

        accounts.push(...(response?.accounts ?? []));
        cursor = response?.cursor ?? null;
        hasNext = Boolean(response?.has_next && cursor);
      } while (hasNext);

      return { accounts };
    },

    async getProduct(productIdValue) {
      return requestCoinbase<CoinbaseApiProduct>({
        apiKeyName,
        baseUrl,
        fetchImpl,
        method: "GET",
        path: `/api/v3/brokerage/products/${encodeURIComponent(
          productIdValue,
        )}`,
        privateKey,
      });
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
          access_secret as accessSecret,
          access_secret_encrypted as accessSecretEncrypted,
          access_token as accessToken,
          access_token_encrypted as accessTokenEncrypted,
          credential_key_version as credentialKeyVersion,
          household_id as householdId,
          id,
          status
        from provider_connections
        where id = ? and provider = ?
      `,
    )
    .bind(connectionId, "coinbase")
    .first<CoinbaseConnectionRow>();
}

async function resolveConnectionCredential(args: {
  encryptedValue: null | string;
  fallbackValue: null | string;
  label: string;
  providerTokenEncryptionKey?: string;
}) {
  if (args.encryptedValue) {
    if (!args.providerTokenEncryptionKey) {
      throw new Error(
        `Coinbase connection requires PROVIDER_TOKEN_ENCRYPTION_KEY for ${args.label}.`,
      );
    }

    return decryptProviderToken({
      encryptedToken: args.encryptedValue,
      secret: args.providerTokenEncryptionKey,
    });
  }

  return args.fallbackValue;
}

async function insertRunningSyncRun(args: {
  connection: CoinbaseConnectionRow;
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
      "coinbase",
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

async function upsertCoinbaseAccount(args: {
  accountBalanceMinor: number;
  connection: CoinbaseConnectionRow;
  database: D1Database;
  now: Date;
  runId: string;
}) {
  const accountId = canonicalAccountId(args.connection.id);
  const providerAccountId = providerAccountRowId(args.connection.id);
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
        "coinbase-spot",
        "Coinbase",
        "Coinbase",
        "brokerage",
        "crypto",
        "USD",
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
            ownership_type,
            include_in_household_reporting,
            is_hidden,
            balance_minor,
            currency,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        "Coinbase",
        "Coinbase",
        "Coinbase",
        "brokerage",
        "crypto",
        "investments",
        "joint",
        1,
        0,
        args.accountBalanceMinor,
        "USD",
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
          on conflict(account_id, source_sync_run_id) do update set
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
        args.accountBalanceMinor,
      ),
  ]);

  return 3;
}

async function upsertCoinbaseHolding(args: {
  account: CoinbaseApiAccount;
  connection: CoinbaseConnectionRow;
  database: D1Database;
  marketValueMinor: number;
  now: Date;
  priceMinor: null | number;
  product: CoinbaseApiProduct | null;
  runId: string;
}) {
  const currency = normalizeCurrency(args.account);
  const accountId = canonicalAccountId(args.connection.id);
  const currentHoldingId = holdingId(args.connection.id, currency);
  const currentSecurityId = isFiatAccount(args.account)
    ? null
    : securityId(currency);
  const asOfDate = args.now.toISOString().slice(0, 10);
  const displayName = args.product?.base_name?.trim() || args.account.name;

  const statements: D1PreparedStatement[] = [];

  if (currentSecurityId) {
    statements.push(
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
            on conflict(provider, provider_security_id) do update set
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
          currentSecurityId,
          "coinbase",
          currency,
          currency,
          displayName,
          "cryptocurrency",
          null,
          "USD",
          "coinbase",
          args.now.getTime(),
          args.now.getTime(),
        ),
    );

    statements.push(
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
          currentSecurityId,
          asOfDate,
          args.priceMinor,
          "USD",
          "coinbase",
          args.priceMinor === null ? 1 : 0,
          args.now.getTime(),
        ),
    );
  }

  statements.push(
    args.database
      .prepare(
        `
          insert into holdings (
            id,
            account_id,
            security_id,
            holding_key,
            symbol,
            name,
            asset_class,
            sub_asset_class,
            currency,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(account_id, holding_key) do update set
            security_id = excluded.security_id,
            symbol = excluded.symbol,
            name = excluded.name,
            asset_class = excluded.asset_class,
            sub_asset_class = excluded.sub_asset_class,
            currency = excluded.currency,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        currentHoldingId,
        accountId,
        currentSecurityId,
        currency,
        currency,
        displayName,
        isFiatAccount(args.account) ? "cash" : "crypto",
        null,
        "USD",
        args.now.getTime(),
        args.now.getTime(),
      ),
  );

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
          on conflict(holding_id, source_sync_run_id) do update set
            captured_at = excluded.captured_at,
            as_of_date = excluded.as_of_date,
            quantity = excluded.quantity,
            price_minor = excluded.price_minor,
            market_value_minor = excluded.market_value_minor,
            cost_basis_minor = excluded.cost_basis_minor
        `,
      )
      .bind(
        holdingSnapshotId(args.runId, currentHoldingId),
        currentHoldingId,
        accountId,
        args.runId,
        args.now.getTime(),
        asOfDate,
        normalizeQuantity(args.account),
        args.priceMinor,
        args.marketValueMinor,
        null,
      ),
  );

  await args.database.batch(statements);

  return statements.length;
}

async function resolveCoinbaseAccountValue(args: {
  account: CoinbaseApiAccount;
  client: CoinbaseClient;
}) {
  const currency = normalizeCurrency(args.account);
  const quantity = normalizeQuantity(args.account);

  if (isFiatAccount(args.account) || currency === "USD") {
    return {
      marketValueMinor: decimalToMinorUnits(quantity),
      priceMinor: 100,
      product: null,
    };
  }

  const product = await args.client.getProduct(productId(currency));
  const price = product?.price?.trim();

  if (!price) {
    return {
      marketValueMinor: 0,
      priceMinor: null,
      product,
    };
  }

  return {
    marketValueMinor: marketValueMinor(quantity, price),
    priceMinor: decimalToMinorUnits(price),
    product,
  };
}

async function resolveCoinbaseClient(args: {
  client?: CoinbaseClient;
  clientFactory?: (config: CoinbaseClientConfig) => CoinbaseClient;
  connection: CoinbaseConnectionRow;
  providerTokenEncryptionKey?: string;
}) {
  if (args.client) {
    return args.client;
  }

  const apiKeyName = await resolveConnectionCredential({
    encryptedValue: args.connection.accessTokenEncrypted,
    fallbackValue: args.connection.accessToken,
    label: "API key name",
    providerTokenEncryptionKey: args.providerTokenEncryptionKey,
  });
  const privateKey = await resolveConnectionCredential({
    encryptedValue: args.connection.accessSecretEncrypted,
    fallbackValue: args.connection.accessSecret,
    label: "private key",
    providerTokenEncryptionKey: args.providerTokenEncryptionKey,
  });

  if (!apiKeyName || !privateKey) {
    return null;
  }

  return (args.clientFactory ?? createCoinbaseClient)({
    apiKeyName,
    privateKey,
  });
}

export async function syncCoinbaseConnection(
  args: CoinbaseSyncConnectionArgs,
): Promise<CoinbaseSyncConnectionResult> {
  const now = args.now ?? new Date();
  const connection = await loadProviderConnection(
    args.database,
    args.connectionId,
  );

  if (!connection) {
    throw new Error(
      `Coinbase connection ${args.connectionId} could not be found.`,
    );
  }

  if (connection.status !== "active") {
    throw new Error(`Coinbase connection ${args.connectionId} is not active.`);
  }

  const currentRunId = runId(connection.id, now);

  await insertRunningSyncRun({
    connection,
    database: args.database,
    now,
    runId: currentRunId,
  });

  try {
    const client = await resolveCoinbaseClient({
      client: args.client,
      clientFactory: args.clientFactory,
      connection,
      providerTokenEncryptionKey: args.providerTokenEncryptionKey,
    });

    if (!client) {
      throw new Error("Coinbase connection is missing credentials.");
    }

    const accountsResponse = await client.getAccounts();
    const activeAccounts = accountsResponse.accounts.filter(
      (account) =>
        account.active !== false &&
        account.ready !== false &&
        !account.deleted_at &&
        hasNonZeroQuantity(account),
    );
    let accountBalanceMinor = 0;
    let recordsChanged = 0;
    const resolvedAccounts = [];

    for (const account of activeAccounts) {
      const value = await resolveCoinbaseAccountValue({ account, client });
      accountBalanceMinor += value.marketValueMinor;
      resolvedAccounts.push({ account, ...value });
    }

    recordsChanged += await upsertCoinbaseAccount({
      accountBalanceMinor,
      connection,
      database: args.database,
      now,
      runId: currentRunId,
    });

    for (const resolvedAccount of resolvedAccounts) {
      recordsChanged += await upsertCoinbaseHolding({
        account: resolvedAccount.account,
        connection,
        database: args.database,
        marketValueMinor: resolvedAccount.marketValueMinor,
        now,
        priceMinor: resolvedAccount.priceMinor,
        product: resolvedAccount.product,
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
        error instanceof Error ? error.message : "Coinbase sync failed.",
      runId: currentRunId,
    });
    throw error;
  }
}

export async function syncConfiguredCoinbaseConnections(
  args: CoinbaseSyncConfiguredConnectionsArgs,
) {
  const connections = await args.database
    .prepare(
      `
        select id
        from provider_connections
        where provider = ?
          and status = ?
          and (access_token_encrypted is not null or access_token is not null)
          and (access_secret_encrypted is not null or access_secret is not null)
      `,
    )
    .bind("coinbase", "active")
    .all<{ id: string }>();

  if (connections.results.length === 0) {
    return [];
  }

  const results = [];

  for (const connection of connections.results) {
    try {
      results.push(
        await syncCoinbaseConnection({
          client: args.client,
          clientFactory: args.clientFactory,
          connectionId: connection.id,
          database: args.database,
          now: args.now,
          providerTokenEncryptionKey: args.providerTokenEncryptionKey,
        }),
      );
    } catch (error) {
      console.error("Scheduled Coinbase sync failed.", {
        connectionId: connection.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
