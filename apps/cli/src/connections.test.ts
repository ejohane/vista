import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getConnection,
  listConnections,
  parseConnectionsArgs,
  removeConnection,
  testConnection,
} from "./connections";
import { type LocalD1Database, openLocalD1Database } from "./local-d1";
import { ensureLocalSchema } from "./schema";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "vista-connections-test-"));
  tempDirs.push(dir);
  return dir;
}

async function makeDatabase() {
  const database = openLocalD1Database(join(makeTempDir(), "vista.sqlite"));
  await ensureLocalSchema(database);
  return database;
}

async function seedConnections(database: LocalD1Database) {
  const now = Date.parse("2026-05-30T12:00:00.000Z");
  const plaidCreatedAt = Date.parse("2026-05-30T12:01:00.000Z");
  const coinbaseCreatedAt = Date.parse("2026-05-30T12:02:00.000Z");

  await database
    .prepare(
      `
        insert into households (id, name, last_synced_at, created_at)
        values (?, ?, ?, ?)
      `,
    )
    .bind("household_demo", "Vista Household", now, now)
    .run();
  await database
    .prepare(
      `
        insert into provider_connections (
          id,
          household_id,
          provider,
          status,
          external_connection_id,
          access_token_encrypted,
          plaid_item_id,
          institution_id,
          institution_name,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      "conn:plaid:item-1",
      "household_demo",
      "plaid",
      "active",
      "item-1",
      "encrypted-plaid-token",
      "item-1",
      "ins_1",
      "Demo Bank",
      plaidCreatedAt,
      plaidCreatedAt,
    )
    .run();
  await database
    .prepare(
      `
        insert into provider_connections (
          id,
          household_id,
          provider,
          status,
          external_connection_id,
          access_token_encrypted,
          access_secret_encrypted,
          institution_id,
          institution_name,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      "conn:coinbase:key-1",
      "household_demo",
      "coinbase",
      "active",
      "organizations/org/apiKeys/key-1",
      "encrypted-api-key-name",
      "encrypted-private-key",
      "coinbase",
      "Coinbase",
      coinbaseCreatedAt,
      coinbaseCreatedAt,
    )
    .run();
  await database
    .prepare(
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
    .bind(
      "sync_plaid_success",
      "household_demo",
      "conn:plaid:item-1",
      "plaid",
      "succeeded",
      "scheduled",
      Date.parse("2026-05-30T12:10:00.000Z"),
      Date.parse("2026-05-30T12:11:00.000Z"),
      3,
      null,
    )
    .run();
  await database
    .prepare(
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
    .bind(
      "sync_coinbase_failed",
      "household_demo",
      "conn:coinbase:key-1",
      "coinbase",
      "failed",
      "scheduled",
      Date.parse("2026-05-30T12:20:00.000Z"),
      Date.parse("2026-05-30T12:21:00.000Z"),
      0,
      "Coinbase API rejected request",
    )
    .run();
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("connections CLI", () => {
  test("parses list/show/test/remove commands", () => {
    expect(parseConnectionsArgs([])).toEqual({
      kind: "list",
    });
    expect(parseConnectionsArgs(["show", "conn:plaid:item-1"])).toEqual({
      connectionId: "conn:plaid:item-1",
      kind: "show",
    });
    expect(parseConnectionsArgs(["test", "conn:plaid:item-1"])).toEqual({
      connectionId: "conn:plaid:item-1",
      kind: "test",
    });
    expect(
      parseConnectionsArgs(["remove", "conn:plaid:item-1", "--yes"]),
    ).toEqual({
      connectionId: "conn:plaid:item-1",
      kind: "remove",
      yes: true,
    });
  });

  test("lists Plaid and Coinbase connections with sync status", async () => {
    const database = await makeDatabase();

    try {
      await seedConnections(database);

      const connections = await listConnections(database);

      expect(connections.map((connection) => connection.id)).toEqual([
        "conn:coinbase:key-1",
        "conn:plaid:item-1",
      ]);
      expect(connections).toMatchObject([
        {
          institutionName: "Coinbase",
          latestSyncError: "Coinbase API rejected request",
          latestSyncStatus: "failed",
          provider: "coinbase",
          status: "active",
        },
        {
          institutionName: "Demo Bank",
          latestSyncStatus: "succeeded",
          lastSuccessfulSyncAt: Date.parse("2026-05-30T12:11:00.000Z"),
          provider: "plaid",
          status: "active",
        },
      ]);
    } finally {
      database.close();
    }
  });

  test("shows one connection and errors clearly for unknown ids", async () => {
    const database = await makeDatabase();

    try {
      await seedConnections(database);

      await expect(getConnection(database, "conn:missing")).rejects.toThrow(
        "Connection not found: conn:missing",
      );

      const connection = await getConnection(database, "conn:coinbase:key-1");

      expect(connection).toMatchObject({
        hasAccessSecret: true,
        hasAccessToken: true,
        id: "conn:coinbase:key-1",
        latestSyncStatus: "failed",
        provider: "coinbase",
        syncRunCount: 1,
      });
    } finally {
      database.close();
    }
  });

  test("validates local connection readiness without provider calls", async () => {
    const database = await makeDatabase();

    try {
      await seedConnections(database);

      const result = await testConnection(database, "conn:coinbase:key-1");

      expect(result.ok).toBe(true);
      expect(result.checks).toEqual([
        {
          ok: true,
          status: "Connection status",
          value: "active",
        },
        {
          ok: true,
          status: "External connection id",
          value: "present",
        },
        {
          ok: true,
          status: "Coinbase API key name credential",
          value: "present",
        },
        {
          ok: true,
          status: "Coinbase private key credential",
          value: "present",
        },
      ]);
    } finally {
      database.close();
    }
  });

  test("remove requires explicit confirmation and clears credentials", async () => {
    const database = await makeDatabase();

    try {
      await seedConnections(database);

      await expect(
        removeConnection({
          connectionId: "conn:coinbase:key-1",
          database,
          yes: false,
        }),
      ).rejects.toThrow("Refusing to remove connection without --yes");

      const changes = await removeConnection({
        connectionId: "conn:coinbase:key-1",
        database,
        now: new Date("2026-05-30T13:00:00.000Z"),
        yes: true,
      });
      const connection = await getConnection(database, "conn:coinbase:key-1");

      expect(changes).toBe(1);
      expect(connection).toMatchObject({
        hasAccessSecret: false,
        hasAccessToken: false,
        status: "disconnected",
        updatedAt: Date.parse("2026-05-30T13:00:00.000Z"),
      });
    } finally {
      database.close();
    }
  });
});
