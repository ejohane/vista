#!/usr/bin/env bun

import { dirname } from "node:path";

import {
  parseAccountsArgs,
  printAccountsHelp,
  runAccountsCommand,
} from "./accounts";
import {
  CONFIG_PATH,
  initializeCliConfig,
  loadCliConfig,
  VISTA_HOME,
} from "./config";
import { connectCoinbase, parseConnectCoinbaseArgs } from "./connect-coinbase";
import {
  connectPlaid,
  parseConnectHealthEquityArgs,
  parseConnectPlaidArgs,
} from "./connect-plaid";
import {
  parseConnectionsArgs,
  printConnectionsHelp,
  runConnectionsCommand,
} from "./connections";
import { printDashboard, printDashboardJson } from "./dashboard";
import {
  parseHoldingsArgs,
  printHoldingsHelp,
  runHoldingsCommand,
} from "./holdings";
import { parseIncomeArgs, printIncomeHelp, runIncomeCommand } from "./income";
import { openLocalD1Database } from "./local-d1";
import { ensureLocalSchema } from "./schema";
import {
  installVistaSkill,
  printSkillHelp,
  VISTA_SKILL_CONTENT,
} from "./skill";
import {
  getSyncRun,
  getVistaStatusSummary,
  listSyncRuns,
  parseSyncRunsArgs,
  parseSyncShowArgs,
  printStatus,
  printSyncRun,
  printSyncRuns,
} from "./status";
import { parseSyncArgs, printSyncResult, syncLocalConnections } from "./sync";
import {
  listTransactions,
  parseTransactionArgs,
  printTransactionDetail,
  printTransactions,
  printTransactionsHelp,
  printTransactionsJson,
  resolveTransactionListOptions,
  setBankTransactionReportingOverride,
  showTransaction,
} from "./transactions";
import { parseUpgradeArgs, printVersion, upgradeCli } from "./upgrade";

function printHelp() {
  console.log(`Vista CLI

Usage:
  vista version [--check]
  vista upgrade [--check] [--force]
  vista init
  vista skill install
  vista skill print
  vista connect plaid [--no-open] [--timeout-seconds 600]
  vista connect healthequity [--no-open] [--timeout-seconds 600]
  vista connect coinbase --api-key-file <path>
  vista connections
  vista connections show <id>
  vista connections test <id>
  vista connections remove <id> --yes
  vista sync [--quiet]
  vista sync runs [--limit 20]
  vista sync show <run-id>
  vista status
  vista dashboard [--json]
  vista accounts [--json]
  vista accounts show <id>
  vista accounts rename <id> "Display Name"
  vista accounts rename <id> --clear
  vista accounts hide <id>
  vista accounts unhide <id>
  vista accounts include <id>
  vista accounts exclude <id>
  vista accounts owner <id> --owner mine|wife|joint
  vista holdings [--json]
  vista holdings show <id-or-symbol> [--json]
  vista holdings classify <id-or-symbol> --asset-class cash|equity|fixed_income|crypto|fund|other [--json]
  vista transactions [--limit 25] [--account <id-or-name>] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--kind bank|investment] [--json]
  vista transactions show <id>
  vista transactions exclude <id>
  vista transactions include <id>
  vista income set --person "Erik" --source "Employer" --salary 150000 [--bonus 25000]
  vista income show [--person "Erik"] [--json]

Local files:
  Config: ${CONFIG_PATH}
  Home:   ${VISTA_HOME}
`);
}

function commandPath(argv: string[]) {
  return argv.filter(Boolean).join(" ");
}

function parseJsonOnlyArgs(argv: string[], commandName: string) {
  const options = {
    json: false,
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
      continue;
    }

    throw new Error(`Unknown ${commandName} option: ${arg}`);
  }

  return options;
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

  if (command === "skill") {
    if (!subcommand || subcommand === "help" || subcommand === "--help") {
      printSkillHelp();
      return;
    }

    if (subcommand === "install") {
      const unexpectedArg = rest.find(Boolean);

      if (unexpectedArg) {
        throw new Error(`Unknown skill install option: ${unexpectedArg}`);
      }

      const skillFilePath = installVistaSkill();
      console.log(`Installed Vista CLI skill: ${skillFilePath}`);
      return;
    }

    if (subcommand === "print") {
      const unexpectedArg = rest.find(Boolean);

      if (unexpectedArg) {
        throw new Error(`Unknown skill print option: ${unexpectedArg}`);
      }

      console.log(VISTA_SKILL_CONTENT);
      return;
    }

    throw new Error(`Unknown skill command: ${subcommand}`);
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

  if (command === "connect" && subcommand === "healthequity") {
    initializeCliConfig();
    const config = loadCliConfig();
    const options = parseConnectHealthEquityArgs(rest);

    await withDatabase(config.databasePath, async (database) => {
      const result = await connectPlaid({
        config,
        database,
        options,
      });

      console.log(`Connected HealthEquity Plaid item ${result.itemId}.`);
      console.log(`Connection: ${result.connectionId}`);
      console.log(`Household: ${result.householdId}`);
    });
    return;
  }

  if (command === "connect" && subcommand === "coinbase") {
    initializeCliConfig();
    const config = loadCliConfig();
    const options = parseConnectCoinbaseArgs(rest);

    await withDatabase(config.databasePath, async (database) => {
      const result = await connectCoinbase({
        config,
        database,
        options,
      });

      console.log("Connected Coinbase.");
      console.log(`Connection: ${result.connectionId}`);
      console.log(`Household: ${result.householdId}`);
    });
    return;
  }

  if (command === "connections") {
    if (
      subcommand === "help" ||
      subcommand === "--help" ||
      subcommand === "-h"
    ) {
      printConnectionsHelp();
      return;
    }

    initializeCliConfig();
    const config = loadCliConfig();
    const options = parseConnectionsArgs([subcommand, ...rest].filter(Boolean));

    await withDatabase(config.databasePath, async (database) => {
      await runConnectionsCommand(database, options);
    });
    return;
  }

  if (command === "sync") {
    initializeCliConfig();
    const config = loadCliConfig();

    if (subcommand === "runs") {
      const options = parseSyncRunsArgs(rest);

      await withDatabase(config.databasePath, async (database) => {
        printSyncRuns(await listSyncRuns(database, options));
      });
      return;
    }

    if (subcommand === "show") {
      const options = parseSyncShowArgs(rest);

      await withDatabase(config.databasePath, async (database) => {
        printSyncRun(await getSyncRun(database, options.runId));
      });
      return;
    }

    const options = parseSyncArgs([subcommand, ...rest].filter(Boolean));

    await withDatabase(config.databasePath, async (database) => {
      const results = await syncLocalConnections({
        config,
        database,
      });

      printSyncResult(results, options);
    });
    return;
  }

  if (command === "status") {
    initializeCliConfig();
    const config = loadCliConfig();

    await withDatabase(config.databasePath, async (database) => {
      printStatus(await getVistaStatusSummary(database));
    });
    return;
  }

  if (command === "accounts") {
    if (
      subcommand === "help" ||
      subcommand === "--help" ||
      subcommand === "-h"
    ) {
      printAccountsHelp();
      return;
    }

    initializeCliConfig();
    const config = loadCliConfig();
    const options = parseAccountsArgs([subcommand, ...rest].filter(Boolean));

    await withDatabase(config.databasePath, async (database) => {
      await runAccountsCommand(database, options);
    });
    return;
  }

  if (command === "dashboard") {
    initializeCliConfig();
    const config = loadCliConfig();
    const options = parseJsonOnlyArgs(
      [subcommand, ...rest].filter(Boolean),
      command,
    );

    await withDatabase(config.databasePath, async (database) => {
      if (options.json) {
        await printDashboardJson(database);
        return;
      }

      await printDashboard(database);
    });
    return;
  }

  if (command === "holdings") {
    if (
      subcommand === "help" ||
      subcommand === "--help" ||
      subcommand === "-h"
    ) {
      printHoldingsHelp();
      return;
    }

    initializeCliConfig();
    const config = loadCliConfig();
    const options = parseHoldingsArgs([subcommand, ...rest].filter(Boolean));

    await withDatabase(config.databasePath, async (database) => {
      await runHoldingsCommand(database, options);
    });
    return;
  }

  if (command === "transactions") {
    if (
      subcommand === "help" ||
      subcommand === "--help" ||
      subcommand === "-h"
    ) {
      printTransactionsHelp();
      return;
    }

    initializeCliConfig();
    const config = loadCliConfig();
    const options = parseTransactionArgs([subcommand, ...rest].filter(Boolean));

    await withDatabase(config.databasePath, async (database) => {
      if (options.mode === "show") {
        printTransactionDetail(await showTransaction(database, options.id));
        return;
      }

      if (options.mode === "exclude" || options.mode === "include") {
        const detail = await setBankTransactionReportingOverride(
          database,
          options.id,
          options.mode === "exclude",
        );
        console.log(
          `Transaction ${options.mode === "exclude" ? "excluded" : "included"} from reporting.`,
        );
        console.log("");
        printTransactionDetail(detail);
        return;
      }

      if (options.mode !== "list") {
        throw new Error(`Unknown transactions command mode: ${options.mode}`);
      }

      const resolvedOptions = await resolveTransactionListOptions(
        database,
        options,
      );
      const transactions = await listTransactions(database, resolvedOptions);

      if (resolvedOptions.json) {
        printTransactionsJson(transactions, resolvedOptions);
        return;
      }

      printTransactions(transactions, resolvedOptions);
    });
    return;
  }

  if (command === "income") {
    if (!subcommand || subcommand === "help" || subcommand === "--help") {
      printIncomeHelp();
      return;
    }

    initializeCliConfig();
    const config = loadCliConfig();

    await withDatabase(config.databasePath, async (database) => {
      await runIncomeCommand(
        database,
        parseIncomeArgs([subcommand, ...rest].filter(Boolean)),
      );
    });
    return;
  }

  throw new Error(`Unknown command: ${commandPath(argv)}`);
}

run(Bun.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
