import { createPlaidClient, type PlaidClient } from "@vista/plaid";

const DEFAULT_HOUSEHOLD_ID = "household_default";
const DEFAULT_HOUSEHOLD_NAME = "Vista Household";
const PLAID_REQUIRED_PRODUCTS = ["investments"] as const;
const PLAID_REQUIRED_IF_SUPPORTED_PRODUCTS = [
  "transactions",
  "liabilities",
] as const;

type CreatePlaidLinkTokenArgs = {
  client?: PlaidClient;
  clientFactory?: (config: {
    clientId: string;
    environment?: "development" | "production" | "sandbox";
    secret: string;
  }) => PlaidClient;
  clientId?: string;
  countryCodes?: string[];
  database: D1Database;
  environment?: "development" | "production" | "sandbox";
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
  database: D1Database;
  environment?: "development" | "production" | "sandbox";
  institutionId?: string;
  institutionName?: string;
  now?: Date;
  publicToken: string;
  secret?: string;
};

type HouseholdRow = {
  id: string;
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

async function ensureHousehold(database: D1Database, now: Date) {
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

  if (existingHousehold) {
    return {
      householdId: existingHousehold.id,
      householdWasCreated: false,
    };
  }

  await database
    .prepare(
      `
        insert into households (id, name, last_synced_at, created_at)
        values (?, ?, ?, ?)
      `,
    )
    .bind(
      DEFAULT_HOUSEHOLD_ID,
      DEFAULT_HOUSEHOLD_NAME,
      now.getTime(),
      now.getTime(),
    )
    .run();

  return {
    householdId: DEFAULT_HOUSEHOLD_ID,
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
  );
  const result = await client.createLinkToken({
    countryCodes: args.countryCodes,
    products: [...PLAID_REQUIRED_PRODUCTS],
    requiredIfSupportedProducts: [...PLAID_REQUIRED_IF_SUPPORTED_PRODUCTS],
    redirectUri: args.redirectUrl,
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
  );
  const exchangeResult = await client.exchangePublicToken({
    publicToken,
  });
  const connectionId = `conn:plaid:${exchangeResult.itemId}`;
  const institutionId = args.institutionId?.trim() || null;
  const institutionName = args.institutionName?.trim() || "Plaid";

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
      exchangeResult.accessToken,
      exchangeResult.itemId,
      institutionId,
      institutionName,
      now.getTime(),
      now.getTime(),
    )
    .run();

  return {
    connectionId,
    householdId,
    householdWasCreated,
  };
}
