import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ensureClerkIdentityMembership } from "./identity";

class FakeD1PreparedStatement {
  constructor(
    private readonly database: Database,
    private readonly query: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new FakeD1PreparedStatement(this.database, this.query, values);
  }

  async first<T>(columnName?: keyof T & string) {
    const row = this.database
      .query(this.query)
      .get(...(this.values as never[])) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    if (columnName) {
      return (row[columnName] as T[keyof T]) ?? null;
    }

    return row as T;
  }

  async run() {
    this.database.query(this.query).run(...(this.values as never[]));
    return { success: true };
  }
}

class FakeD1Database {
  constructor(private readonly database: Database) {}

  async batch(statements: FakeD1PreparedStatement[]) {
    try {
      this.database.exec("BEGIN");

      const results = [];

      for (const statement of statements) {
        results.push(await statement.run());
      }

      this.database.exec("COMMIT");

      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  exec(query: string) {
    this.database.exec(query);
    return Promise.resolve();
  }

  prepare(query: string) {
    return new FakeD1PreparedStatement(this.database, query);
  }
}

function applyMigrations(database: Database) {
  const migrationsDir = fileURLToPath(
    new URL("../migrations/", import.meta.url).toString(),
  );
  const migrationFiles = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  for (const fileName of migrationFiles) {
    database.exec(readFileSync(`${migrationsDir}/${fileName}`, "utf8"));
  }
}

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  applyMigrations(sqlite);

  return {
    database: new FakeD1Database(sqlite) as unknown as D1Database,
    sqlite,
  };
}

describe("ensureClerkIdentityMembership", () => {
  test("creates a household, owner member, and user identity for the first sign-in", async () => {
    const { database, sqlite } = createTestDatabase();
    const now = new Date("2026-04-11T12:00:00.000Z");

    const result = await ensureClerkIdentityMembership({
      clerkUserId: "user_123",
      database,
      emailAddress: "erik@example.com",
      firstName: "Erik",
      now,
    });

    expect(result.created).toBe(true);
    expect(result.householdName).toBe("Erik Household");
    expect(result.memberRole).toBe("owner");

    expect(
      sqlite
        .query(
          `
            select count(*) as count
            from households
          `,
        )
        .get(),
    ).toEqual({ count: 1 });

    expect(
      sqlite
        .query(
          `
            select
              members.household_id as householdId,
              members.role as memberRole,
              user_identities.provider as provider,
              user_identities.provider_user_id as providerUserId
            from user_identities
            inner join members on members.id = user_identities.member_id
          `,
        )
        .get(),
    ).toEqual({
      householdId: result.householdId,
      memberRole: "owner",
      provider: "clerk",
      providerUserId: "user_123",
    });
  });

  test("reuses an existing membership for repeat sign-ins", async () => {
    const { database, sqlite } = createTestDatabase();
    const firstNow = new Date("2026-04-11T12:00:00.000Z");
    const secondNow = new Date("2026-04-12T08:30:00.000Z");

    const firstResult = await ensureClerkIdentityMembership({
      clerkUserId: "user_123",
      database,
      emailAddress: "erik@example.com",
      firstName: "Erik",
      now: firstNow,
    });
    const secondResult = await ensureClerkIdentityMembership({
      clerkUserId: "user_123",
      database,
      emailAddress: "erik@example.com",
      firstName: "Erik",
      now: secondNow,
    });

    expect(secondResult.created).toBe(false);
    expect(secondResult.householdId).toBe(firstResult.householdId);
    expect(secondResult.memberId).toBe(firstResult.memberId);

    expect(
      sqlite
        .query(
          `
            select
              (select count(*) from households) as householdCount,
              (select count(*) from members) as memberCount,
              (select count(*) from user_identities) as identityCount
          `,
        )
        .get(),
    ).toEqual({
      householdCount: 1,
      identityCount: 1,
      memberCount: 1,
    });
  });

  test("does not attach a second Clerk user to the first household by default", async () => {
    const { database } = createTestDatabase();

    const firstResult = await ensureClerkIdentityMembership({
      clerkUserId: "user_123",
      database,
      firstName: "Erik",
      now: new Date("2026-04-11T12:00:00.000Z"),
    });
    const secondResult = await ensureClerkIdentityMembership({
      clerkUserId: "user_456",
      database,
      firstName: "Anna",
      now: new Date("2026-04-11T12:05:00.000Z"),
    });

    expect(secondResult.created).toBe(true);
    expect(secondResult.householdId).not.toBe(firstResult.householdId);
    expect(secondResult.memberId).not.toBe(firstResult.memberId);
    expect(secondResult.householdName).toBe("Anna Household");
  });
});
