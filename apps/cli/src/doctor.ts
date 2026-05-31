import { existsSync } from "node:fs";

import type { CliConfig } from "./config";
import { CONFIG_PATH } from "./config";
import { listConnections, testConnection } from "./connections";
import { printJson } from "./json-output";
import type { LocalD1Database } from "./local-d1";
import { getVistaStatusSummary } from "./status";

type DoctorCheckStatus = "fail" | "ok" | "warn";

export type DoctorCheck = {
  detail: string;
  id: string;
  label: string;
  status: DoctorCheckStatus;
  suggestion?: string;
};

export type DoctorReport = {
  checks: DoctorCheck[];
  generatedAt: string;
  ok: boolean;
  summary: {
    fail: number;
    ok: number;
    warn: number;
  };
};

export type DoctorOptions = {
  json: boolean;
};

function check(args: DoctorCheck) {
  return args;
}

function summarize(checks: DoctorCheck[]) {
  return checks.reduce(
    (summary, item) => {
      summary[item.status] += 1;
      return summary;
    },
    { fail: 0, ok: 0, warn: 0 } satisfies DoctorReport["summary"],
  );
}

export function parseDoctorArgs(argv: string[]): DoctorOptions {
  const options: DoctorOptions = {
    json: false,
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
      continue;
    }

    throw new Error(`Unknown doctor option: ${arg}`);
  }

  return options;
}

export async function getDoctorReport(args: {
  config: CliConfig;
  configExists?: boolean;
  configPath?: string;
  database?: LocalD1Database;
  databaseExists?: boolean;
  now?: Date;
}): Promise<DoctorReport> {
  const now = args.now ?? new Date();
  const configPath = args.configPath ?? CONFIG_PATH;
  const configExists = args.configExists ?? existsSync(configPath);
  const databaseExists =
    args.databaseExists ?? existsSync(args.config.databasePath);
  const checks: DoctorCheck[] = [
    check({
      detail: configExists ? configPath : "config file was not found",
      id: "config-file",
      label: "Config file",
      status: configExists ? "ok" : "warn",
      suggestion: configExists ? undefined : "Run `vista init`.",
    }),
    check({
      detail: args.config.databasePath,
      id: "database-path",
      label: "Database path",
      status: args.config.databasePath.trim() ? "ok" : "fail",
      suggestion: args.config.databasePath.trim()
        ? undefined
        : "Run `vista init` to create a CLI config.",
    }),
    check({
      detail: databaseExists ? args.config.databasePath : "database not found",
      id: "database-file",
      label: "Database file",
      status: databaseExists ? "ok" : "warn",
      suggestion: databaseExists
        ? undefined
        : "Run `vista init`, connect a provider, or run `vista sync` after connecting.",
    }),
    check({
      detail: args.config.providerTokenEncryptionKey ? "present" : "missing",
      id: "provider-token-encryption-key",
      label: "Provider token encryption key",
      status: args.config.providerTokenEncryptionKey ? "ok" : "fail",
      suggestion: args.config.providerTokenEncryptionKey
        ? undefined
        : "Run `vista init` to create local encryption settings.",
    }),
  ];

  if (!args.database || !databaseExists) {
    const summary = summarize(checks);

    return {
      checks,
      generatedAt: now.toISOString(),
      ok: summary.fail === 0,
      summary,
    };
  }

  const [connections, status] = await Promise.all([
    listConnections(args.database),
    getVistaStatusSummary(args.database, now),
  ]);
  const activePlaidConnections = connections.filter(
    (connection) =>
      connection.provider === "plaid" && connection.status === "active",
  );

  checks.push(
    check({
      detail:
        connections.length === 0
          ? "no provider connections"
          : `${status.activeConnectionCount} active / ${status.connectionCount} total`,
      id: "provider-connections",
      label: "Provider connections",
      status:
        status.activeConnectionCount > 0
          ? "ok"
          : connections.length > 0
            ? "warn"
            : "warn",
      suggestion:
        status.activeConnectionCount > 0
          ? undefined
          : "Connect Plaid, HealthEquity, or Coinbase.",
    }),
    check({
      detail: activePlaidConnections.length
        ? args.config.plaidClientId
          ? "present"
          : "missing"
        : args.config.plaidClientId
          ? "present"
          : "not configured",
      id: "plaid-client-id",
      label: "Plaid client id",
      status: activePlaidConnections.length
        ? args.config.plaidClientId
          ? "ok"
          : "fail"
        : args.config.plaidClientId
          ? "ok"
          : "warn",
      suggestion: args.config.plaidClientId
        ? undefined
        : "Set PLAID_CLIENT_ID before connecting or syncing Plaid accounts.",
    }),
    check({
      detail: activePlaidConnections.length
        ? args.config.plaidSecret
          ? "present"
          : "missing"
        : args.config.plaidSecret
          ? "present"
          : "not configured",
      id: "plaid-secret",
      label: "Plaid secret",
      status: activePlaidConnections.length
        ? args.config.plaidSecret
          ? "ok"
          : "fail"
        : args.config.plaidSecret
          ? "ok"
          : "warn",
      suggestion: args.config.plaidSecret
        ? undefined
        : "Set PLAID_SECRET before connecting or syncing Plaid accounts.",
    }),
    check({
      detail: args.config.plaidEnvironment ?? "sandbox",
      id: "plaid-environment",
      label: "Plaid environment",
      status: "ok",
    }),
  );

  for (const connection of connections) {
    const result = await testConnection(args.database, connection.id);
    checks.push(
      check({
        detail: result.ok
          ? "local validation passed"
          : "local validation failed",
        id: `connection:${connection.id}`,
        label: `Connection ${connection.provider}:${connection.institutionName ?? connection.id}`,
        status: result.ok ? "ok" : "fail",
        suggestion: result.ok
          ? undefined
          : `Run \`vista connections test ${connection.id}\`.`,
      }),
    );
  }

  checks.push(
    check({
      detail: status.latestSync
        ? `${status.latestSync.status} at ${new Date(
            status.latestSync.completedAt ?? status.latestSync.startedAt,
          ).toISOString()}`
        : "never",
      id: "latest-sync",
      label: "Latest sync",
      status: !status.latestSync
        ? "warn"
        : status.latestSync.status === "failed"
          ? "fail"
          : status.latestSync.status === "running"
            ? "warn"
            : "ok",
      suggestion:
        status.latestSync?.status === "failed"
          ? "Run `vista sync show <run-id>` for the latest failed sync."
          : status.latestSync
            ? undefined
            : "Run `vista sync` after connecting a provider.",
    }),
    check({
      detail: `${status.staleActiveConnectionCount} stale, ${status.neverSyncedActiveConnectionCount} never synced`,
      id: "sync-freshness",
      label: "Sync freshness",
      status:
        status.staleActiveConnectionCount > 0 ||
        status.neverSyncedActiveConnectionCount > 0
          ? "warn"
          : "ok",
      suggestion:
        status.staleActiveConnectionCount > 0 ||
        status.neverSyncedActiveConnectionCount > 0
          ? "Run `vista sync`."
          : undefined,
    }),
    check({
      detail: `${status.recordCounts.accounts} accounts, ${status.recordCounts.holdings} holdings, ${status.recordCounts.bankTransactions} bank transactions, ${status.recordCounts.investmentTransactions} investment transactions`,
      id: "local-records",
      label: "Local records",
      status:
        status.recordCounts.accounts > 0 ||
        status.recordCounts.holdings > 0 ||
        status.recordCounts.bankTransactions > 0 ||
        status.recordCounts.investmentTransactions > 0
          ? "ok"
          : "warn",
      suggestion:
        status.recordCounts.accounts > 0 ||
        status.recordCounts.holdings > 0 ||
        status.recordCounts.bankTransactions > 0 ||
        status.recordCounts.investmentTransactions > 0
          ? undefined
          : "Connect a provider and run `vista sync`.",
    }),
  );

  const summary = summarize(checks);

  return {
    checks,
    generatedAt: now.toISOString(),
    ok: summary.fail === 0,
    summary,
  };
}

function statusLabel(status: DoctorCheckStatus) {
  return status.toUpperCase().padEnd(4, " ");
}

export function printDoctorReport(report: DoctorReport) {
  console.log("Vista Doctor");
  console.log(
    `Summary: ${report.summary.ok} ok, ${report.summary.warn} warn, ${report.summary.fail} fail`,
  );
  console.log("");

  for (const item of report.checks) {
    console.log(`${statusLabel(item.status)} ${item.label}: ${item.detail}`);

    if (item.suggestion) {
      console.log(`     ${item.suggestion}`);
    }
  }
}

export function printDoctorReportJson(report: DoctorReport) {
  printJson({
    ...report,
    schemaVersion: 1,
  });
}
