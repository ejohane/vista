import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function applySqlFiles(database: Database, directory: URL) {
  const resolvedDirectory = fileURLToPath(directory.toString());
  const sqlFiles = readdirSync(resolvedDirectory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  for (const fileName of sqlFiles) {
    database.exec(readFileSync(`${resolvedDirectory}/${fileName}`, "utf8"));
  }
}

export class FakeD1PreparedStatement {
  constructor(
    private readonly database: Database,
    private readonly query: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new FakeD1PreparedStatement(this.database, this.query, values);
  }

  async all<T>() {
    return {
      results: this.database
        .query(this.query)
        .all(...(this.values as never[])) as T[],
    };
  }

  async first<T>() {
    const row = this.database
      .query(this.query)
      .get(...(this.values as never[]));
    return (row as T | undefined) ?? null;
  }

  async raw<T>() {
    return this.database
      .query(this.query)
      .values(...(this.values as never[])) as T[];
  }

  async run() {
    this.database.query(this.query).run(...(this.values as never[]));
    return { success: true };
  }
}

export class FakeD1Database {
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

function createBaseDatabase() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  applySqlFiles(
    sqlite,
    new URL("../../../packages/db/migrations/", import.meta.url),
  );

  return sqlite;
}

export function createEmptySyncDatabase() {
  const sqlite = createBaseDatabase();

  return {
    d1: new FakeD1Database(sqlite) as unknown as D1Database,
    sqlite,
  };
}

export function createSeededSyncDatabase() {
  const sqlite = createBaseDatabase();
  sqlite.exec(
    readFileSync(
      fileURLToPath(
        new URL(
          "../../../packages/db/seeds/dev.sql",
          import.meta.url,
        ).toString(),
      ),
      "utf8",
    ),
  );

  return {
    d1: new FakeD1Database(sqlite) as unknown as D1Database,
    sqlite,
  };
}
