import { syncConfiguredPlaidConnections } from "@vista/plaid";

import type { CliConfig } from "./config";
import type { LocalD1Database } from "./local-d1";

type SyncOptions = {
  quiet: boolean;
};

function requireConfigValue(value: string | undefined, name: string) {
  if (!value?.trim()) {
    throw new Error(`${name} is required for Plaid sync.`);
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
  );
  const secret = requireConfigValue(args.config.plaidSecret, "PLAID_SECRET");
  const providerTokenEncryptionKey = requireConfigValue(
    args.config.providerTokenEncryptionKey,
    "PROVIDER_TOKEN_ENCRYPTION_KEY",
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

export function printSyncResult(
  results: Awaited<ReturnType<typeof syncLocalPlaidConnections>>,
  options: SyncOptions,
) {
  if (options.quiet) {
    return;
  }

  if (results.length === 0) {
    console.log("No active Plaid connections to sync.");
    return;
  }

  const recordsChanged = results.reduce(
    (total, result) => total + result.recordsChanged,
    0,
  );

  console.log(
    `Synced ${results.length} Plaid connection${results.length === 1 ? "" : "s"}.`,
  );
  console.log(`Records changed: ${recordsChanged}`);

  for (const result of results) {
    console.log(`Run: ${result.runId}`);
  }
}
