import { createPlaidClient, type PlaidClient } from "@vista/plaid";

const DEFAULT_HOUSEHOLD_NAME = "Vista Household";
const PLAID_REQUIRED_PRODUCTS = ["investments"] as const;
const PLAID_REQUIRED_IF_SUPPORTED_PRODUCTS = [
  "transactions",
  "liabilities",
] as const;
const PLAID_TRANSACTIONS_DAYS_REQUESTED = 730;

type CreatePlaidLinkTokenArgs = {
  client?: PlaidClient;
  clientFactory?: (config: {
    clientId: string;
    environment?: "development" | "production" | "sandbox";
    secret: string;
  }) => PlaidClient;
  clientId?: string;
  countryCodes?: string[];
  createHouseholdId?: () => string;
  database: D1Database;
  environment?: "development" | "production" | "sandbox";
  householdId?: string;
  householdName?: string;
  now?: Date;
  redirectUrl?: string;
  secret?: string;
};

type ExchangePlaidPublicTokenArgs = {
  client?: PlaidClient;
  clientFactory?: (config: {
    clientId: string;
    environment?: "development" | "production" | "sandbox";
    secret: string;
  }) => PlaidClient;
  clientId?: string;
  createHouseholdId?: () => string;
  database: D1Database;
  environment?: "development" | "production" | "sandbox";
  householdId?: string;
  householdName?: string;
  institutionId?: string;
  institutionName?: string;
  now?: Date;
  onConnectionPersisted?: (args: {
    accessToken: string;
    connectionId: string;
    createdAt: Date;
    externalConnectionId: string;
    householdId: string;
    institutionId: null | string;
    institutionName: string;
    plaidItemId: string;
    updatedAt: Date;
  }) => Promise<void>;
  persistAccessTokenInDatabase?: boolean;
  publicToken: string;
  secret?: string;
};

type HouseholdRow = {
  id: string;
};

type HouseholdCountRow = {
  count: number;
};

export type CreatedPlaidLinkToken = {
  householdId: string;
  householdWasCreated: boolean;
  linkToken: string;
};

export type ExchangedPlaidConnection = {
  connectionId: string;
  householdId: string;
  householdWasCreated: boolean;
};

function createGeneratedHouseholdId() {
  return `household_${crypto.randomUUID()}`;
}

async function ensureHousehold(
  database: D1Database,
  now: Date,
  args: {
    createHouseholdId?: () => string;
    householdId?: string;
    householdName?: string;
  },
) {
  const requestedHouseholdId = args.householdId?.trim();

  if (requestedHouseholdId) {
    const existingHousehold = await database
      .prepare(
        `
          select id
          from households
          where id = ?
          limit 1
        `,
      )
      .bind(requestedHouseholdId)
      .first<HouseholdRow>();

    if (!existingHousehold) {
      throw new Error(`Household ${requestedHouseholdId} could not be found.`);
    }

    return {
      householdId: existingHousehold.id,
      householdWasCreated: false,
    };
  }

  const householdCount = await database
    .prepare(
      `
        select count(*) as count
        from households
      `,
    )
    .first<HouseholdCountRow>();

  const resolvedHouseholdCount = Number(householdCount?.count ?? 0);

  if (resolvedHouseholdCount === 1) {
    const existingHousehold = await database
      .prepare(
        `
          select id
          from households
          order by created_at asc
          limit 1
        `,
      )
      .first<HouseholdRow>();

    if (!existingHousehold) {
      throw new Error("The household registry is out of sync.");
    }

    return {
      householdId: existingHousehold.id,
      householdWasCreated: false,
    };
  }

  if (resolvedHouseholdCount > 1) {
    throw new Error(
      "Multiple households are available. Pass householdId explicitly.",
    );
  }

  const householdId =
    args.createHouseholdId?.() ?? createGeneratedHouseholdId();
  const householdName = args.householdName?.trim() || DEFAULT_HOUSEHOLD_NAME;

  await database
    .prepare(
      `
        insert into households (id, name, last_synced_at, created_at)
        values (?, ?, ?, ?)
      `,
    )
    .bind(householdId, householdName, now.getTime(), now.getTime())
    .run();

  return {
    householdId,
    householdWasCreated: true,
  };
}

function resolvePlaidClient(args: {
  client?: PlaidClient;
  clientFactory?: (config: {
    clientId: string;
    environment?: "development" | "production" | "sandbox";
    secret: string;
  }) => PlaidClient;
  clientId?: string;
  environment?: "development" | "production" | "sandbox";
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

export async function createPlaidLinkToken(
  args: CreatePlaidLinkTokenArgs,
): Promise<CreatedPlaidLinkToken> {
  const now = args.now ?? new Date();
  const client = resolvePlaidClient(args);

  if (!client) {
    throw new Error("Plaid client configuration is required.");
  }

  const { householdId, householdWasCreated } = await ensureHousehold(
    args.database,
    now,
    {
      createHouseholdId: args.createHouseholdId,
      householdId: args.householdId,
      householdName: args.householdName,
    },
  );
  const result = await client.createLinkToken({
    countryCodes: args.countryCodes,
    products: [...PLAID_REQUIRED_PRODUCTS],
    requiredIfSupportedProducts: [...PLAID_REQUIRED_IF_SUPPORTED_PRODUCTS],
    redirectUri: args.redirectUrl,
    transactionsDaysRequested: PLAID_TRANSACTIONS_DAYS_REQUESTED,
    userId: householdId,
  });

  return {
    householdId,
    householdWasCreated,
    linkToken: result.linkToken,
  };
}

export async function exchangePlaidPublicToken(
  args: ExchangePlaidPublicTokenArgs,
): Promise<ExchangedPlaidConnection> {
  const now = args.now ?? new Date();
  const client = resolvePlaidClient(args);

  if (!client) {
    throw new Error("Plaid client configuration is required.");
  }

  const publicToken = args.publicToken.trim();

  if (!publicToken) {
    throw new Error("Plaid did not return a valid connection token.");
  }

  const { householdId, householdWasCreated } = await ensureHousehold(
    args.database,
    now,
    {
      createHouseholdId: args.createHouseholdId,
      householdId: args.householdId,
      householdName: args.householdName,
    },
  );
  const exchangeResult = await client.exchangePublicToken({
    publicToken,
  });
  const connectionId = `conn:plaid:${exchangeResult.itemId}`;
  const institutionId = args.institutionId?.trim() || null;
  const institutionName = args.institutionName?.trim() || "Plaid";
  const persistAccessTokenInDatabase =
    args.persistAccessTokenInDatabase ?? true;

  await args.database
    .prepare(
      `
        insert into provider_connections (
          id,
          household_id,
          provider,
          status,
          external_connection_id,
          access_token,
          plaid_item_id,
          institution_id,
          institution_name,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(provider, external_connection_id) do update set
          household_id = excluded.household_id,
          status = excluded.status,
          access_token = excluded.access_token,
          plaid_item_id = excluded.plaid_item_id,
          institution_id = excluded.institution_id,
          institution_name = excluded.institution_name,
          updated_at = excluded.updated_at
      `,
    )
    .bind(
      connectionId,
      householdId,
      "plaid",
      "active",
      exchangeResult.itemId,
      persistAccessTokenInDatabase ? exchangeResult.accessToken : null,
      exchangeResult.itemId,
      institutionId,
      institutionName,
      now.getTime(),
      now.getTime(),
    )
    .run();

  await args.onConnectionPersisted?.({
    accessToken: exchangeResult.accessToken,
    connectionId,
    createdAt: now,
    externalConnectionId: exchangeResult.itemId,
    householdId,
    institutionId,
    institutionName,
    plaidItemId: exchangeResult.itemId,
    updatedAt: now,
  });

  return {
    connectionId,
    householdId,
    householdWasCreated,
  };
}
