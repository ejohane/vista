import { Database } from "bun:sqlite";

import { HOUSEHOLD_STATE_SCHEMA_SQL } from "./schema";

class SqlitePreparedStatement {
  constructor(
    private readonly database: Database,
    private readonly query: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new SqlitePreparedStatement(this.database, this.query, values);
  }

  async all<T>() {
    return {
      results: this.database
        .query(this.query)
        .all(...(this.values as never[])) as T[],
    };
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

  async raw<T>() {
    return this.database
      .query(this.query)
      .values(...(this.values as never[])) as T[];
  }

  runSync() {
    const result = this.database
      .query(this.query)
      .run(...(this.values as never[]));

    return {
      meta: {
        changes: result.changes,
      },
      success: true,
    };
  }

  async run() {
    return this.runSync();
  }
}

export function createSqliteTestHouseholdDatabase() {
  const sqlite = new Database(":memory:");
  sqlite.exec(HOUSEHOLD_STATE_SCHEMA_SQL);

  return {
    database: {
      async batch(statements: SqlitePreparedStatement[]) {
        try {
          sqlite.exec("BEGIN");

          const results = statements.map((statement) => statement.runSync());

          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },

      exec(query: string) {
        sqlite.exec(query);
        return Promise.resolve();
      },

      prepare(query: string) {
        return new SqlitePreparedStatement(sqlite, query);
      },
    } as unknown as D1Database,
    sqlite,
  };
}
