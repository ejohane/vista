import { syncConfiguredCoinbaseConnections } from "@vista/coinbase";
import { syncConfiguredPlaidConnections } from "@vista/plaid";

import type { CliConfig } from "./config";
import type { LocalD1Database } from "./local-d1";

type SyncOptions = {
  quiet: boolean;
};

type LocalSyncResult = {
  provider: "coinbase" | "plaid";
  recordsChanged: number;
  runId: string;
  status: "succeeded";
};

function requireConfigValue(
  value: string | undefined,
  name: string,
  provider: string,
) {
  if (!value?.trim()) {
    throw new Error(`${name} is required for ${provider} sync.`);
  }

  return value;
}

export function parseSyncArgs(argv: string[]): SyncOptions {
  const options: SyncOptions = {
    quiet: false,
  };

  for (const arg of argv) {
    if (arg === "--quiet") {
      options.quiet = true;
      continue;
    }

    throw new Error(`Unknown sync option: ${arg}`);
  }

  return options;
}

export async function syncLocalPlaidConnections(args: {
  config: CliConfig;
  database: LocalD1Database;
  now?: Date;
}) {
  const clientId = requireConfigValue(
    args.config.plaidClientId,
    "PLAID_CLIENT_ID",
    "Plaid",
  );
  const secret = requireConfigValue(
    args.config.plaidSecret,
    "PLAID_SECRET",
    "Plaid",
  );
  const providerTokenEncryptionKey = requireConfigValue(
    args.config.providerTokenEncryptionKey,
    "PROVIDER_TOKEN_ENCRYPTION_KEY",
    "Plaid",
  );

  return syncConfiguredPlaidConnections({
    clientId,
    database: args.database,
    environment: args.config.plaidEnvironment,
    now: args.now,
    providerTokenEncryptionKey,
    secret,
  });
}

async function hasActiveProviderConnection(
  database: LocalD1Database,
  provider: "coinbase" | "plaid",
) {
  const row = await database
    .prepare(
      `
        select count(*) as count
        from provider_connections
        where provider = ? and status = ?
      `,
    )
    .bind(provider, "active")
    .first<{ count: number }>();

  return Number(row?.count ?? 0) > 0;
}

export async function syncLocalConnections(args: {
  config: CliConfig;
  database: LocalD1Database;
  now?: Date;
}) {
  const hasPlaidConnection = await hasActiveProviderConnection(
    args.database,
    "plaid",
  );
  const hasCoinbaseConnection = await hasActiveProviderConnection(
    args.database,
    "coinbase",
  );
  const providerTokenEncryptionKey =
    hasCoinbaseConnection || hasPlaidConnection
      ? requireConfigValue(
          args.config.providerTokenEncryptionKey,
          "PROVIDER_TOKEN_ENCRYPTION_KEY",
          "provider",
        )
      : undefined;
  const plaidResults = hasPlaidConnection
    ? await syncLocalPlaidConnections(args)
    : [];
  const coinbaseResults = hasCoinbaseConnection
    ? await syncConfiguredCoinbaseConnections({
        database: args.database,
        now: args.now,
        providerTokenEncryptionKey,
      })
    : [];

  return [
    ...plaidResults.map((result) => ({
      ...result,
      provider: "plaid" as const,
    })),
    ...coinbaseResults.map((result) => ({
      ...result,
      provider: "coinbase" as const,
    })),
  ] satisfies LocalSyncResult[];
}

export function printSyncResult(
  results: LocalSyncResult[],
  options: SyncOptions,
) {
  if (options.quiet) {
    return;
  }

  if (results.length === 0) {
    console.log("No active provider connections to sync.");
    return;
  }

  const recordsChanged = results.reduce(
    (total, result) => total + result.recordsChanged,
    0,
  );

  console.log(
    `Synced ${results.length} provider connection${results.length === 1 ? "" : "s"}.`,
  );
  console.log(`Records changed: ${recordsChanged}`);

  for (const result of results) {
    console.log(`Run (${result.provider}): ${result.runId}`);
  }
}
