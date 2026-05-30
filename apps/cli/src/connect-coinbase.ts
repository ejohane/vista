import { existsSync, readFileSync } from "node:fs";

import { encryptProviderToken } from "@vista/plaid";

import type { CliConfig } from "./config";
import type { LocalD1Database } from "./local-d1";

const DEFAULT_HOUSEHOLD_NAME = "Vista Household";

type ConnectCoinbaseArgs = {
  apiKeyFile?: string;
  apiKeyName?: string;
  householdId?: string;
  householdName?: string;
  privateKeyFile?: string;
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

    return existingHousehold.id;
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

    return existingHousehold.id;
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

  return householdId;
}

function requireConfigValue(value: string | undefined, name: string) {
  if (!value?.trim()) {
    throw new Error(`${name} is required for Coinbase connection.`);
  }

  return value;
}

function connectionIdForApiKeyName(apiKeyName: string) {
  const keyId = apiKeyName.split("/").at(-1)?.trim() || apiKeyName;
  return `conn:coinbase:${keyId.replaceAll(":", "_")}`;
}

function readPrivateKey(path: string) {
  if (!existsSync(path)) {
    throw new Error(`Coinbase private key file does not exist: ${path}`);
  }

  return readFileSync(path, "utf8");
}

function readApiKeyFile(path: string) {
  if (!existsSync(path)) {
    throw new Error(`Coinbase API key file does not exist: ${path}`);
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    apiKeyName?: unknown;
    api_key_name?: unknown;
    id?: unknown;
    key_name?: unknown;
    name?: unknown;
    privateKey?: unknown;
    private_key?: unknown;
  };
  const apiKeyName =
    typeof parsed.name === "string"
      ? parsed.name
      : typeof parsed.key_name === "string"
        ? parsed.key_name
        : typeof parsed.apiKeyName === "string"
          ? parsed.apiKeyName
          : typeof parsed.api_key_name === "string"
            ? parsed.api_key_name
            : typeof parsed.id === "string"
              ? parsed.id
              : null;
  const privateKey =
    typeof parsed.privateKey === "string"
      ? parsed.privateKey
      : typeof parsed.private_key === "string"
        ? parsed.private_key
        : null;

  if (!apiKeyName?.trim()) {
    throw new Error("Coinbase API key file is missing a key name.");
  }

  if (!privateKey?.trim()) {
    throw new Error("Coinbase API key file is missing a private key.");
  }

  return {
    apiKeyName: apiKeyName.trim(),
    privateKey: privateKey.trim(),
  };
}

async function persistCoinbaseConnection(args: {
  apiKeyName: string;
  database: LocalD1Database;
  householdId: string;
  now: Date;
  privateKey: string;
  providerTokenEncryptionKey: string;
}) {
  const encryptedApiKeyName = await encryptProviderToken({
    plaintext: args.apiKeyName,
    secret: args.providerTokenEncryptionKey,
  });
  const encryptedPrivateKey = await encryptProviderToken({
    plaintext: args.privateKey,
    secret: args.providerTokenEncryptionKey,
  });
  const connectionId = connectionIdForApiKeyName(args.apiKeyName);

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
          access_secret,
          access_secret_encrypted,
          credential_key_version,
          institution_id,
          institution_name,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(provider, external_connection_id) do update set
          household_id = excluded.household_id,
          status = excluded.status,
          access_token = excluded.access_token,
          access_token_encrypted = excluded.access_token_encrypted,
          access_secret = excluded.access_secret,
          access_secret_encrypted = excluded.access_secret_encrypted,
          credential_key_version = excluded.credential_key_version,
          institution_id = excluded.institution_id,
          institution_name = excluded.institution_name,
          updated_at = excluded.updated_at
      `,
    )
    .bind(
      connectionId,
      args.householdId,
      "coinbase",
      "active",
      args.apiKeyName,
      null,
      encryptedApiKeyName,
      null,
      encryptedPrivateKey,
      1,
      "coinbase",
      "Coinbase",
      args.now.getTime(),
      args.now.getTime(),
    )
    .run();

  return connectionId;
}

export function parseConnectCoinbaseArgs(argv: string[]): ConnectCoinbaseArgs {
  const args: ConnectCoinbaseArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--api-key-name") {
      index += 1;
      args.apiKeyName = argv[index];
      continue;
    }

    if (arg === "--api-key-file") {
      index += 1;
      args.apiKeyFile = argv[index];
      continue;
    }

    if (arg === "--private-key-file") {
      index += 1;
      args.privateKeyFile = argv[index];
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

    throw new Error(`Unknown connect coinbase option: ${arg}`);
  }

  return args;
}

export async function connectCoinbase(args: {
  config: CliConfig;
  database: LocalD1Database;
  options: ConnectCoinbaseArgs;
}) {
  const providerTokenEncryptionKey = requireConfigValue(
    args.config.providerTokenEncryptionKey,
    "PROVIDER_TOKEN_ENCRYPTION_KEY",
  );
  const fileCredentials = args.options.apiKeyFile
    ? readApiKeyFile(args.options.apiKeyFile)
    : null;
  const apiKeyName =
    args.options.apiKeyName?.trim() ?? fileCredentials?.apiKeyName;
  const privateKey = args.options.privateKeyFile
    ? readPrivateKey(args.options.privateKeyFile)
    : fileCredentials?.privateKey;

  if (!apiKeyName) {
    throw new Error("--api-key-name or --api-key-file is required.");
  }

  if (!privateKey) {
    throw new Error("--private-key-file or --api-key-file is required.");
  }

  const now = new Date();
  const householdId = await ensureHousehold(args.database, now, {
    householdId: args.options.householdId,
    householdName: args.options.householdName,
  });
  const connectionId = await persistCoinbaseConnection({
    apiKeyName,
    database: args.database,
    householdId,
    now,
    privateKey,
    providerTokenEncryptionKey,
  });

  return {
    connectionId,
    householdId,
  };
}
