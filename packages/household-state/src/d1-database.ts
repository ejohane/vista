import { HOUSEHOLD_STATE_SCHEMA_SQL } from "./schema";

type SqlStorageCursorLike = {
  raw: () => Iterable<unknown[]>;
  rowsWritten: number;
  toArray: () => Array<Record<string, unknown>>;
};

type DurableObjectSqlLike = {
  exec: (query: string, ...bindings: unknown[]) => SqlStorageCursorLike;
};

type DurableObjectStorageLike = {
  sql: DurableObjectSqlLike;
  sync?: () => Promise<void>;
  transactionSync: <T>(callback: () => T) => T;
};

class DurableObjectPreparedStatement {
  constructor(
    private readonly storage: DurableObjectStorageLike,
    private readonly query: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new DurableObjectPreparedStatement(this.storage, this.query, values);
  }

  async all<T>() {
    return {
      results: this.storage.sql
        .exec(this.query, ...this.values)
        .toArray() as T[],
    };
  }

  async first<T>(columnName?: keyof T & string) {
    const row =
      (this.storage.sql.exec(this.query, ...this.values).toArray()[0] as
        | Record<string, unknown>
        | undefined) ?? null;

    if (!row) {
      return null;
    }

    if (columnName) {
      return (row[columnName] as T[keyof T]) ?? null;
    }

    return row as T;
  }

  async raw<T>() {
    return Array.from(
      this.storage.sql.exec(this.query, ...this.values).raw(),
    ) as T[];
  }

  runSync() {
    const cursor = this.storage.sql.exec(this.query, ...this.values);

    return {
      meta: {
        changes: cursor.rowsWritten,
      },
      success: true,
    };
  }

  async run() {
    return this.runSync();
  }
}

export function createDurableObjectSqliteD1Database(
  storage: DurableObjectStorageLike,
) {
  return {
    async batch(statements: DurableObjectPreparedStatement[]) {
      return storage.transactionSync(() =>
        statements.map((statement) => statement.runSync()),
      );
    },

    exec(query: string) {
      storage.sql.exec(query);
      return Promise.resolve();
    },

    prepare(query: string) {
      return new DurableObjectPreparedStatement(storage, query);
    },

    sync() {
      return storage.sync?.() ?? Promise.resolve();
    },
  } as unknown as D1Database & { sync: () => Promise<void> };
}

export function ensureHouseholdStateSchema(database: D1Database) {
  return database.exec(HOUSEHOLD_STATE_SCHEMA_SQL);
}
