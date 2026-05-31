import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getDoctorReport,
  parseDoctorArgs,
  printDoctorReportJson,
} from "./doctor";
import { type LocalD1Database, openLocalD1Database } from "./local-d1";
import { ensureLocalSchema } from "./schema";

function createTempDatabasePath() {
  const dir = mkdtempSync(join(tmpdir(), "vista-doctor-test-"));

  return {
    cleanup: () => rmSync(dir, { force: true, recursive: true }),
    path: join(dir, "vista.sqlite"),
  };
}

async function makeDatabase() {
  const temp = createTempDatabasePath();
  const database = openLocalD1Database(temp.path);

  await ensureLocalSchema(database);

  return {
    cleanup: () => {
      database.close();
      temp.cleanup();
    },
    database,
    path: temp.path,
  };
}

function seedDoctorData(database: LocalD1Database) {
  const createdAt = Date.parse("2026-05-30T08:00:00.000Z");
  const completedAt = Date.parse("2026-05-30T09:01:00.000Z");

  database.sqlite
    .query(
      `
        insert into households (id, name, last_synced_at, created_at)
        values (?, ?, ?, ?)
      `,
    )
    .run("household_default", "Vista Household", completedAt, createdAt);
  database.sqlite
    .query(
      `
        insert into provider_connections (
          id,
          household_id,
          provider,
          status,
          external_connection_id,
          access_token_encrypted,
          institution_name,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      "conn_plaid",
      "household_default",
      "plaid",
      "active",
      "item-1",
      "encrypted-token",
      "Demo Bank",
      createdAt,
      createdAt,
    );
  database.sqlite
    .query(
      `
        insert into sync_runs (
          id,
          household_id,
          provider_connection_id,
          provider,
          status,
          trigger,
          started_at,
          completed_at,
          records_changed,
          error_summary
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      "sync_success",
      "household_default",
      "conn_plaid",
      "plaid",
      "succeeded",
      "scheduled",
      Date.parse("2026-05-30T09:00:00.000Z"),
      completedAt,
      2,
      null,
    );
  database.sqlite
    .query(
      `
        insert into accounts (
          id,
          household_id,
          name,
          institution_name,
          account_type,
          reporting_group,
          balance_minor,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      "acct_cash",
      "household_default",
      "Checking",
      "Demo Bank",
      "checking",
      "cash",
      100_00,
      createdAt,
      createdAt,
    );
}

function captureConsole(callback: () => void) {
  const originalLog = console.log;
  const lines: string[] = [];

  console.log = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };

  try {
    callback();
  } finally {
    console.log = originalLog;
  }

  return lines.join("\n");
}

describe("doctor CLI", () => {
  test("parses supported options", () => {
    expect(parseDoctorArgs([])).toEqual({ json: false });
    expect(parseDoctorArgs(["--json"])).toEqual({ json: true });
    expect(() => parseDoctorArgs(["--bad"])).toThrow(
      "Unknown doctor option: --bad",
    );
  });

  test("reports missing local setup without opening the database", async () => {
    const report = await getDoctorReport({
      config: {
        databasePath: "/tmp/missing-vista.sqlite",
        plaidEnvironment: "sandbox",
      },
      configExists: false,
      databaseExists: false,
      now: new Date("2026-05-30T12:00:00.000Z"),
    });

    expect(report.ok).toBe(false);
    expect(report.summary).toEqual({ fail: 1, ok: 1, warn: 2 });
    expect(report.checks.map((item) => [item.id, item.status])).toEqual([
      ["config-file", "warn"],
      ["database-path", "ok"],
      ["database-file", "warn"],
      ["provider-token-encryption-key", "fail"],
    ]);
  });

  test("fails active Plaid connections when required credentials are missing", async () => {
    const { cleanup, database, path } = await makeDatabase();

    try {
      seedDoctorData(database);

      const report = await getDoctorReport({
        config: {
          databasePath: path,
          plaidEnvironment: "sandbox",
          providerTokenEncryptionKey: "local-key",
        },
        configExists: true,
        database,
        databaseExists: true,
        now: new Date("2026-05-30T12:00:00.000Z"),
      });

      expect(report.ok).toBe(false);
      expect(
        report.checks
          .filter((item) => item.status === "fail")
          .map((item) => item.id),
      ).toEqual(["plaid-client-id", "plaid-secret"]);
    } finally {
      cleanup();
    }
  });

  test("passes local health checks for a synced configured CLI", async () => {
    const { cleanup, database, path } = await makeDatabase();

    try {
      seedDoctorData(database);

      const report = await getDoctorReport({
        config: {
          databasePath: path,
          plaidClientId: "client-id",
          plaidEnvironment: "sandbox",
          plaidSecret: "secret",
          providerTokenEncryptionKey: "local-key",
        },
        configExists: true,
        database,
        databaseExists: true,
        now: new Date("2026-05-30T12:00:00.000Z"),
      });

      expect(report.ok).toBe(true);
      expect(report.summary.fail).toBe(0);
      expect(report.checks.map((item) => item.id)).toContain(
        "connection:conn_plaid",
      );
      expect(
        report.checks.find((item) => item.id === "latest-sync"),
      ).toMatchObject({
        status: "ok",
      });
    } finally {
      cleanup();
    }
  });

  test("prints valid JSON", async () => {
    const report = await getDoctorReport({
      config: {
        databasePath: "/tmp/missing-vista.sqlite",
        plaidEnvironment: "sandbox",
      },
      configExists: false,
      databaseExists: false,
      now: new Date("2026-05-30T12:00:00.000Z"),
    });
    const output = captureConsole(() => printDoctorReportJson(report));

    expect(JSON.parse(output)).toMatchObject({
      ok: false,
      schemaVersion: 1,
      summary: { fail: 1, ok: 1, warn: 2 },
    });
  });
});
