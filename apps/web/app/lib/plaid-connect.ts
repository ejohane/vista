import {
  createPlaidClient,
  encryptProviderToken,
  type PlaidClient,
} from "@vista/plaid";

const PLAID_REQUIRED_PRODUCTS = ["investments"] as const;

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
  householdId: string;
  now?: Date;
  providerTokenEncryptionKey?: string;
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
  householdId: string;
  institutionId?: string;
  institutionName?: string;
  now?: Date;
  providerTokenEncryptionKey: string;
  publicToken: string;
  secret?: string;
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
  const client = resolvePlaidClient(args);

  if (!client) {
    throw new Error("Plaid client configuration is required.");
  }

  const result = await client.createLinkToken({
    countryCodes: args.countryCodes,
    products: [...PLAID_REQUIRED_PRODUCTS],
    redirectUri: args.redirectUrl,
    userId: args.householdId,
  });

  return {
    householdId: args.householdId,
    householdWasCreated: false,
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

  const exchangeResult = await client.exchangePublicToken({
    publicToken,
  });
  const encryptedAccessToken = await encryptProviderToken({
    plaintext: exchangeResult.accessToken,
    secret: args.providerTokenEncryptionKey,
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
          access_token_encrypted,
          credential_key_version,
          plaid_item_id,
          institution_id,
          institution_name,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(provider, external_connection_id) do update set
          household_id = excluded.household_id,
          status = excluded.status,
          access_token = excluded.access_token,
          access_token_encrypted = excluded.access_token_encrypted,
          credential_key_version = excluded.credential_key_version,
          plaid_item_id = excluded.plaid_item_id,
          institution_id = excluded.institution_id,
          institution_name = excluded.institution_name,
          updated_at = excluded.updated_at
      `,
    )
    .bind(
      connectionId,
      args.householdId,
      "plaid",
      "active",
      exchangeResult.itemId,
      null,
      encryptedAccessToken,
      1,
      exchangeResult.itemId,
      institutionId,
      institutionName,
      now.getTime(),
      now.getTime(),
    )
    .run();

  return {
    connectionId,
    householdId: args.householdId,
    householdWasCreated: false,
  };
}
