import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type CoinbaseClient,
  createCoinbaseJwt,
  syncCoinbaseConnection,
} from "@vista/coinbase";

import { parseConnectCoinbaseArgs } from "./connect-coinbase";
import { type LocalD1Database, openLocalD1Database } from "./local-d1";
import { ensureLocalSchema } from "./schema";

function createTempDatabasePath() {
  const dir = mkdtempSync(join(tmpdir(), "vista-coinbase-test-"));

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
    cleanup: temp.cleanup,
    database,
  };
}

function insertCoinbaseConnection(database: LocalD1Database) {
  const now = Date.parse("2026-05-25T12:00:00.000Z");

  database.sqlite
    .query(
      `
        insert into households (id, name, last_synced_at, created_at)
        values (?, ?, ?, ?)
      `,
    )
    .run("household_default", "Vista Household", now, now);
  database.sqlite
    .query(
      `
        insert into provider_connections (
          id,
          household_id,
          provider,
          status,
          external_connection_id,
          institution_name,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      "conn:coinbase:key-1",
      "household_default",
      "coinbase",
      "active",
      "organizations/org/apiKeys/key-1",
      "Coinbase",
      now,
      now,
    );
}

describe("Coinbase CLI sync", () => {
  test("signs Coinbase Advanced Trade JWTs with a PEM private key", () => {
    const { privateKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const pem = privateKey.export({
      format: "pem",
      type: "sec1",
    });
    const jwt = createCoinbaseJwt({
      apiKeyName: "organizations/org/apiKeys/key-1",
      method: "GET",
      now: new Date("2026-05-25T13:00:00.000Z"),
      path: "/api/v3/brokerage/accounts",
      privateKey: String(pem),
    });

    expect(jwt.split(".")).toHaveLength(3);
  });

  test("signs Coinbase Advanced Trade JWTs with a raw Ed25519 API key", () => {
    const rawKey = Buffer.concat([randomBytes(32), randomBytes(32)]).toString(
      "base64",
    );
    const jwt = createCoinbaseJwt({
      apiKeyName: "organizations/org/apiKeys/key-1",
      method: "GET",
      now: new Date("2026-05-25T13:00:00.000Z"),
      path: "/api/v3/brokerage/accounts",
      privateKey: rawKey,
    });
    const [encodedHeader] = jwt.split(".");
    const header = JSON.parse(
      Buffer.from(encodedHeader, "base64url").toString("utf8"),
    ) as { alg: string };

    expect(jwt.split(".")).toHaveLength(3);
    expect(header.alg).toBe("EdDSA");
  });

  test("parses the downloaded Coinbase API key file option", async () => {
    const temp = createTempDatabasePath();
    const apiKeyFile = join(temp.path, "../cdp_api_key.json");

    try {
      writeFileSync(
        apiKeyFile,
        JSON.stringify({
          id: "organizations/org/apiKeys/key-1",
          privateKey: Buffer.concat([
            randomBytes(32),
            randomBytes(32),
          ]).toString("base64"),
        }),
      );

      expect(parseConnectCoinbaseArgs(["--api-key-file", apiKeyFile])).toEqual({
        apiKeyFile,
      });
    } finally {
      temp.cleanup();
    }
  });

  test("stores Coinbase balances as one investment account with holdings", async () => {
    const { cleanup, database } = await makeDatabase();

    try {
      insertCoinbaseConnection(database);

      const client: CoinbaseClient = {
        async getAccounts() {
          return {
            accounts: [
              {
                active: true,
                available_balance: {
                  currency: "BTC",
                  value: "0.5",
                },
                name: "BTC Wallet",
                ready: true,
                type: "CRYPTO",
                uuid: "btc-account",
              },
              {
                active: true,
                available_balance: {
                  currency: "USD",
                  value: "10",
                },
                name: "USD Wallet",
                ready: true,
                type: "FIAT",
                uuid: "usd-account",
              },
              {
                active: true,
                available_balance: {
                  currency: "ETH",
                  value: "0",
                },
                name: "ETH Wallet",
                ready: true,
                type: "CRYPTO",
                uuid: "eth-account",
              },
            ],
          };
        },
        async getProduct(productId) {
          if (productId !== "BTC-USD") {
            return null;
          }

          return {
            base_name: "Bitcoin",
            price: "60000.00",
            product_id: "BTC-USD",
          };
        },
      };

      const result = await syncCoinbaseConnection({
        client,
        connectionId: "conn:coinbase:key-1",
        database,
        now: new Date("2026-05-25T13:00:00.000Z"),
      });
      const account = database.sqlite
        .query(
          `
            select balance_minor as balanceMinor, reporting_group as reportingGroup
            from accounts
            where id = ?
          `,
        )
        .get("acct:coinbase:conn_coinbase_key-1:spot") as {
        balanceMinor: number;
        reportingGroup: string;
      };
      const holdings = database.sqlite
        .query(
          `
            select h.symbol, h.asset_class as assetClass, hs.market_value_minor as marketValueMinor
            from holdings h
            join holding_snapshots hs on hs.holding_id = h.id
            order by h.symbol asc
          `,
        )
        .all() as Array<{
        assetClass: string;
        marketValueMinor: number;
        symbol: string;
      }>;

      expect(result.status).toBe("succeeded");
      expect(account).toEqual({
        balanceMinor: 3001000,
        reportingGroup: "investments",
      });
      expect(holdings).toEqual([
        {
          assetClass: "crypto",
          marketValueMinor: 3000000,
          symbol: "BTC",
        },
        {
          assetClass: "cash",
          marketValueMinor: 1000,
          symbol: "USD",
        },
      ]);
    } finally {
      database.close();
      cleanup();
    }
  });

  test("upgrades old local check constraints to accept Coinbase rows", async () => {
    const temp = createTempDatabasePath();
    const sqlite = new Database(temp.path, { create: true });

    try {
      sqlite.exec(`
        pragma foreign_keys = on;

        create table households (
          id text primary key,
          name text not null,
          last_synced_at integer not null,
          created_at integer not null
        );

        create table provider_connections (
          id text primary key,
          household_id text not null references households(id),
          provider text not null check (provider in ('plaid')),
          status text not null check (status in ('active', 'disconnected', 'error')),
          external_connection_id text not null,
          access_token text,
          access_token_encrypted text,
          access_secret text,
          access_secret_encrypted text,
          access_url text,
          credential_key_version integer default 1,
          plaid_item_id text,
          institution_id text,
          institution_name text,
          created_at integer not null,
          updated_at integer not null
        );

        create table sync_runs (
          id text primary key,
          household_id text not null references households(id),
          provider_connection_id text references provider_connections(id),
          provider text check (provider is null or provider in ('plaid')),
          status text not null check (status in ('running', 'succeeded', 'failed')),
          trigger text not null check (trigger in ('seed', 'scheduled')),
          started_at integer not null,
          completed_at integer,
          records_changed integer not null default 0,
          error_summary text
        );

        create table securities (
          id text primary key,
          provider text not null check (provider in ('plaid')),
          provider_security_id text not null,
          symbol text,
          name text not null,
          security_type text,
          security_subtype text,
          currency text not null default 'USD',
          price_source text not null check (price_source in ('alpha_vantage', 'plaid_holdings', 'missing')),
          created_at integer not null,
          updated_at integer not null
        );

        create table security_price_daily (
          security_id text not null references securities(id),
          price_date text not null,
          close_price_minor integer,
          currency text not null default 'USD',
          source text not null check (source in ('alpha_vantage', 'plaid_holdings', 'missing')),
          is_estimated integer not null default 0 check (is_estimated in (0, 1)),
          fetched_at integer not null
        );
      `);
      sqlite.close();

      const database = openLocalD1Database(temp.path);

      try {
        await ensureLocalSchema(database);

        database.sqlite
          .query(
            `
              insert into households (id, name, last_synced_at, created_at)
              values (?, ?, ?, ?)
            `,
          )
          .run("household_default", "Vista Household", 1, 1);
        database.sqlite
          .query(
            `
              insert into provider_connections (
                id,
                household_id,
                provider,
                status,
                external_connection_id,
                institution_name,
                created_at,
                updated_at
              )
              values (?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            "conn:coinbase:key-1",
            "household_default",
            "coinbase",
            "active",
            "key-1",
            "Coinbase",
            1,
            1,
          );

        expect(
          database.sqlite
            .query("select provider from provider_connections")
            .get(),
        ).toEqual({ provider: "coinbase" });
      } finally {
        database.close();
      }
    } finally {
      temp.cleanup();
    }
  });
});
