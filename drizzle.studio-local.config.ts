import { defineConfig } from "drizzle-kit";

const localSqlitePath = process.env.VISTA_LOCAL_D1_SQLITE_PATH;

if (!localSqlitePath) {
  throw new Error(
    "VISTA_LOCAL_D1_SQLITE_PATH is required. Run `bun run db:studio:local` instead of invoking drizzle-kit studio directly.",
  );
}

export default defineConfig({
  dialect: "sqlite",
  out: "./packages/db/migrations",
  schema: "./packages/db/src/schema.ts",
  dbCredentials: {
    url: localSqlitePath,
  },
});
