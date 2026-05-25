import { spawn } from "node:child_process";

import {
  createPlaidClient,
  encryptProviderToken,
  type PlaidClient,
} from "@vista/plaid";

import type { CliConfig } from "./config";
import type { LocalD1Database } from "./local-d1";

const DEFAULT_HOUSEHOLD_NAME = "Vista Household";
const PLAID_REQUIRED_PRODUCTS = ["investments"] as const;
const PLAID_REQUIRED_IF_SUPPORTED_PRODUCTS = [
  "transactions",
  "liabilities",
] as const;
const PLAID_TRANSACTIONS_DAYS_REQUESTED = 730;
const DEFAULT_TIMEOUT_SECONDS = 600;

type ConnectPlaidArgs = {
  householdId?: string;
  householdName?: string;
  openBrowser: boolean;
  timeoutSeconds: number;
};

type HouseholdRow = {
  id: string;
};

type HouseholdCountRow = {
  count: number;
};

function createGeneratedHouseholdId() {
  return `household_${crypto.randomUUID()}`;
}

async function ensureHousehold(
  database: LocalD1Database,
  now: Date,
  args: {
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
      "Multiple households are available. Pass --household-id explicitly.",
    );
  }

  const householdId = createGeneratedHouseholdId();
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

function requireConfigValue(value: string | undefined, name: string) {
  if (!value?.trim()) {
    throw new Error(`${name} is required for Plaid connection.`);
  }

  return value;
}

function openUrl(url: string) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });

  child.unref();
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForPublicToken(args: {
  client: PlaidClient;
  linkToken: string;
  timeoutSeconds: number;
}) {
  if (!args.client.getLinkToken) {
    throw new Error("Plaid client does not support hosted Link polling.");
  }

  const startedAt = Date.now();
  const timeoutMs = args.timeoutSeconds * 1000;

  while (Date.now() - startedAt < timeoutMs) {
    const result = await args.client.getLinkToken({
      linkToken: args.linkToken,
    });

    for (const session of result.linkSessions) {
      const itemAddResult = session.itemAddResults[0];
      const publicToken = itemAddResult?.publicToken ?? session.publicTokens[0];

      if (publicToken) {
        return {
          institutionId: itemAddResult?.institutionId ?? null,
          institutionName: itemAddResult?.institutionName ?? "Plaid",
          publicToken,
        };
      }
    }

    await wait(3000);
  }

  throw new Error(
    `Timed out waiting for Plaid Hosted Link completion after ${args.timeoutSeconds} seconds.`,
  );
}

async function persistPlaidConnection(args: {
  accessToken: string;
  database: LocalD1Database;
  householdId: string;
  institutionId: null | string;
  institutionName: string;
  itemId: string;
  now: Date;
  providerTokenEncryptionKey: string;
}) {
  const encryptedAccessToken = await encryptProviderToken({
    plaintext: args.accessToken,
    secret: args.providerTokenEncryptionKey,
  });
  const connectionId = `conn:plaid:${args.itemId}`;

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
      args.itemId,
      null,
      encryptedAccessToken,
      1,
      args.itemId,
      args.institutionId,
      args.institutionName,
      args.now.getTime(),
      args.now.getTime(),
    )
    .run();

  return connectionId;
}

export function parseConnectPlaidArgs(argv: string[]): ConnectPlaidArgs {
  const args: ConnectPlaidArgs = {
    openBrowser: true,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--no-open") {
      args.openBrowser = false;
      continue;
    }

    if (arg === "--household-id") {
      index += 1;
      args.householdId = argv[index];
      continue;
    }

    if (arg === "--household-name") {
      index += 1;
      args.householdName = argv[index];
      continue;
    }

    if (arg === "--timeout-seconds") {
      index += 1;
      args.timeoutSeconds = Number(argv[index]);
      continue;
    }

    throw new Error(`Unknown connect plaid option: ${arg}`);
  }

  if (!Number.isFinite(args.timeoutSeconds) || args.timeoutSeconds <= 0) {
    throw new Error("--timeout-seconds must be a positive number.");
  }

  return args;
}

export async function connectPlaid(args: {
  config: CliConfig;
  database: LocalD1Database;
  options: ConnectPlaidArgs;
}) {
  const clientId = requireConfigValue(
    args.config.plaidClientId,
    "PLAID_CLIENT_ID",
  );
  const secret = requireConfigValue(args.config.plaidSecret, "PLAID_SECRET");
  const providerTokenEncryptionKey = requireConfigValue(
    args.config.providerTokenEncryptionKey,
    "PROVIDER_TOKEN_ENCRYPTION_KEY",
  );
  const now = new Date();
  const client = createPlaidClient({
    clientId,
    environment: args.config.plaidEnvironment,
    secret,
  });
  const { householdId, householdWasCreated } = await ensureHousehold(
    args.database,
    now,
    {
      householdId: args.options.householdId,
      householdName: args.options.householdName,
    },
  );
  const linkTokenResult = await client.createLinkToken({
    hostedLink: {
      urlLifetimeSeconds: args.options.timeoutSeconds,
    },
    products: [...PLAID_REQUIRED_PRODUCTS],
    redirectUri: args.config.plaidRedirectUri,
    requiredIfSupportedProducts: [...PLAID_REQUIRED_IF_SUPPORTED_PRODUCTS],
    transactionsDaysRequested: PLAID_TRANSACTIONS_DAYS_REQUESTED,
    userId: householdId,
  });

  if (!linkTokenResult.hostedLinkUrl) {
    throw new Error("Plaid did not return a Hosted Link URL.");
  }

  console.log(`Hosted Link URL: ${linkTokenResult.hostedLinkUrl}`);

  if (args.options.openBrowser) {
    openUrl(linkTokenResult.hostedLinkUrl);
    console.log("Opened Plaid Hosted Link in your browser.");
  }

  console.log("Waiting for Plaid Link completion...");

  const completedLink = await waitForPublicToken({
    client,
    linkToken: linkTokenResult.linkToken,
    timeoutSeconds: args.options.timeoutSeconds,
  });
  const exchangeResult = await client.exchangePublicToken({
    publicToken: completedLink.publicToken,
  });
  const connectionId = await persistPlaidConnection({
    accessToken: exchangeResult.accessToken,
    database: args.database,
    householdId,
    institutionId: completedLink.institutionId,
    institutionName: completedLink.institutionName,
    itemId: exchangeResult.itemId,
    now,
    providerTokenEncryptionKey,
  });

  return {
    connectionId,
    householdId,
    householdWasCreated,
    itemId: exchangeResult.itemId,
  };
}
