#!/usr/bin/env bun

import { dirname } from "node:path";

import { listAccounts, printAccounts } from "./accounts";
import {
  CONFIG_PATH,
  initializeCliConfig,
  loadCliConfig,
  VISTA_HOME,
} from "./config";
import { connectPlaid, parseConnectPlaidArgs } from "./connect-plaid";
import { printDashboard } from "./dashboard";
import { listHoldings, printHoldings } from "./holdings";
import { openLocalD1Database } from "./local-d1";
import { ensureLocalSchema } from "./schema";
import {
  parseSyncArgs,
  printSyncResult,
  syncLocalPlaidConnections,
} from "./sync";
import {
  listTransactions,
  parseTransactionArgs,
  printTransactions,
} from "./transactions";
import { parseUpgradeArgs, printVersion, upgradeCli } from "./upgrade";

function printHelp() {
  console.log(`Vista CLI

Usage:
  vista version [--check]
  vista upgrade [--check] [--force]
  vista init
  vista connect plaid [--no-open] [--timeout-seconds 600]
  vista sync [--quiet]
  vista dashboard
  vista accounts
  vista holdings
  vista transactions [--limit 25]

Local files:
  Config: ${CONFIG_PATH}
  Home:   ${VISTA_HOME}
`);
}

function commandPath(argv: string[]) {
  return argv.filter(Boolean).join(" ");
}

async function withDatabase<T>(
  databasePath: string,
  callback: (database: ReturnType<typeof openLocalD1Database>) => Promise<T>,
) {
  const database = openLocalD1Database(databasePath);

  try {
    await ensureLocalSchema(database);
    return await callback(database);
  } finally {
    database.close();
  }
}

async function run(argv: string[]) {
  const [command, subcommand, ...rest] = argv;

  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    printHelp();
    return;
  }

  if (command === "version") {
    await printVersion(subcommand === "--check");
    return;
  }

  if (command === "upgrade" || command === "self-update") {
    await upgradeCli(parseUpgradeArgs([subcommand, ...rest].filter(Boolean)));
    return;
  }

  if (command === "init") {
    const { config, created } = initializeCliConfig();
    const databasePath = config.databasePath;

    if (!databasePath) {
      throw new Error("Vista CLI config did not resolve a database path.");
    }

    await withDatabase(databasePath, async () => undefined);

    console.log(
      `${created ? "Created" : "Updated"} Vista CLI state in ${dirname(
        databasePath,
      )}`,
    );
    console.log(`Config: ${CONFIG_PATH}`);
    console.log(`Database: ${databasePath}`);
    return;
  }

  if (command === "connect" && subcommand === "plaid") {
    initializeCliConfig();
    const config = loadCliConfig();
    const options = parseConnectPlaidArgs(rest);

    await withDatabase(config.databasePath, async (database) => {
      const result = await connectPlaid({
        config,
        database,
        options,
      });

      console.log(`Connected Plaid item ${result.itemId}.`);
      console.log(`Connection: ${result.connectionId}`);
      console.log(`Household: ${result.householdId}`);
    });
    return;
  }

  if (command === "sync") {
    initializeCliConfig();
    const config = loadCliConfig();
    const options = parseSyncArgs([subcommand, ...rest].filter(Boolean));

    await withDatabase(config.databasePath, async (database) => {
      const results = await syncLocalPlaidConnections({
        config,
        database,
      });

      printSyncResult(results, options);
    });
    return;
  }

  if (command === "accounts") {
    initializeCliConfig();
    const config = loadCliConfig();

    await withDatabase(config.databasePath, async (database) => {
      printAccounts(await listAccounts(database));
    });
    return;
  }

  if (command === "dashboard") {
    initializeCliConfig();
    const config = loadCliConfig();

    await withDatabase(config.databasePath, async (database) => {
      await printDashboard(database);
    });
    return;
  }

  if (command === "holdings") {
    initializeCliConfig();
    const config = loadCliConfig();

    await withDatabase(config.databasePath, async (database) => {
      printHoldings(await listHoldings(database));
    });
    return;
  }

  if (command === "transactions") {
    initializeCliConfig();
    const config = loadCliConfig();
    const options = parseTransactionArgs([subcommand, ...rest].filter(Boolean));

    await withDatabase(config.databasePath, async (database) => {
      printTransactions(await listTransactions(database, options), options);
    });
    return;
  }

  throw new Error(`Unknown command: ${commandPath(argv)}`);
}

run(Bun.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
