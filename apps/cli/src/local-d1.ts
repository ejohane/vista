import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

type SQLiteValue = Uint8Array | boolean | number | string | null;

function createD1Meta(overrides: Partial<D1Meta> = {}): D1Meta {
  return {
    changed_db: false,
    changes: 0,
    duration: 0,
    last_row_id: 0,
    rows_read: 0,
    rows_written: 0,
    size_after: 0,
    ...overrides,
  };
}

function normalizeSQLiteValue(value: unknown): SQLiteValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof Uint8Array
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  throw new Error(`Unsupported SQLite bind value: ${typeof value}`);
}

class LocalD1PreparedStatement {
  private params: SQLiteValue[] = [];

  constructor(
    private readonly database: Database,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.params = values.map(normalizeSQLiteValue);
    return this as unknown as D1PreparedStatement;
  }

  async first<T = unknown>(columnName?: string) {
    const row = this.database.query(this.sql).get(...this.params) as Record<
      string,
      unknown
    > | null;

    if (!row) {
      return null;
    }

    if (columnName) {
      return row[columnName] as T;
    }

    return row as T;
  }

  async all<T = unknown>() {
    const results = this.database.query(this.sql).all(...this.params) as T[];

    return {
      meta: createD1Meta({
        rows_read: results.length,
      }),
      results,
      success: true,
    } as unknown as D1Result<T>;
  }

  async raw<T = unknown>() {
    return this.database.query(this.sql).values(...this.params) as T[];
  }

  async run() {
    const result = this.database.query(this.sql).run(...this.params);

    return {
      meta: createD1Meta({
        changed_db: result.changes > 0,
        changes: result.changes,
        last_row_id: Number(result.lastInsertRowid),
        rows_written: result.changes,
      }),
      results: [],
      success: true,
    } as unknown as D1Result;
  }
}

export type LocalD1Database = D1Database & {
  close(): void;
  sqlite: Database;
};

export function openLocalD1Database(databasePath: string): LocalD1Database {
  mkdirSync(dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath, {
    create: true,
  });
  sqlite.exec("pragma foreign_keys = on");

  const database = {
    close() {
      sqlite.close();
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      const results: D1Result<T>[] = [];

      for (const statement of statements) {
        results.push((await statement.run()) as D1Result<T>);
      }

      return results;
    },
    async dump() {
      return new ArrayBuffer(0);
    },
    async exec(query: string) {
      sqlite.exec(query);

      return {
        count: 0,
        duration: 0,
      } as D1ExecResult;
    },
    prepare(query: string) {
      return new LocalD1PreparedStatement(
        sqlite,
        query,
      ) as unknown as D1PreparedStatement;
    },
    sqlite,
  };

  return database as LocalD1Database;
}
