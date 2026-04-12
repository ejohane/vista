import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const stateDir = path.join(rootDir, "apps", "web", ".wrangler", "state");
const seedMarkerPath = path.join(stateDir, ".seeded-from-main");
const skipSeedMarkerPath = path.join(stateDir, ".skip-seed-from-main");
const studioConfigPath = path.join(rootDir, "drizzle.studio-local.config.ts");
const drizzleKitBin = path.join(
  rootDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "drizzle-kit.cmd" : "drizzle-kit",
);

function logStep(message: string) {
  console.log(`[db:studio:local] ${message}`);
}

function listFilesRecursive(dirPath: string): string[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  const entries = readdirSync(dirPath, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      return listFilesRecursive(entryPath);
    }

    return entryPath;
  });
}

function findLocalSqliteFile() {
  return (
    listFilesRecursive(stateDir)
      .filter((filePath) => filePath.endsWith(".sqlite"))
      .sort((leftPath, rightPath) => {
        const leftModifiedAt = statSync(leftPath).mtimeMs;
        const rightModifiedAt = statSync(rightPath).mtimeMs;

        return rightModifiedAt - leftModifiedAt;
      })[0] ?? null
  );
}

function runCommand(command: string[], label: string) {
  logStep(label);

  const child = Bun.spawnSync(command, {
    cwd: rootDir,
    env: process.env,
    stderr: "inherit",
    stdout: "inherit",
  });

  if (child.exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${child.exitCode}.`);
  }
}

function resolveMainWorktreePath() {
  const child = Bun.spawnSync(["git", "worktree", "list", "--porcelain"], {
    cwd: rootDir,
    env: process.env,
    stderr: "inherit",
    stdout: "pipe",
  });

  if (child.exitCode !== 0) {
    throw new Error("Unable to resolve git worktree layout.");
  }

  const output = child.stdout.toString().trim();
  const firstWorktreeLine = output
    .split(/\r?\n/)
    .find((line) => line.startsWith("worktree "));

  if (!firstWorktreeLine) {
    throw new Error("Git worktree list did not include a main worktree path.");
  }

  return firstWorktreeLine.slice("worktree ".length).trim();
}

function ensureWorktreeStateSeededFromMain() {
  const mainWorktreePath = resolveMainWorktreePath();

  if (
    mainWorktreePath === rootDir ||
    existsSync(seedMarkerPath) ||
    existsSync(skipSeedMarkerPath)
  ) {
    return;
  }

  const mainStateDir = path.join(
    mainWorktreePath,
    "apps",
    "web",
    ".wrangler",
    "state",
  );
  const localSqlitePath = findLocalSqliteFile();

  if (localSqlitePath || !existsSync(mainStateDir)) {
    return;
  }

  const mainSqliteFiles = listFilesRecursive(mainStateDir).filter((filePath) =>
    filePath.endsWith(".sqlite"),
  );

  if (mainSqliteFiles.length === 0) {
    return;
  }

  mkdirSync(path.dirname(stateDir), { recursive: true });
  cpSync(mainStateDir, stateDir, { recursive: true });
  writeFileSync(
    seedMarkerPath,
    `Seeded from ${mainWorktreePath} on ${new Date().toISOString()}\n`,
    "utf8",
  );
  logStep(
    `Seeded local Wrangler state from main worktree at ${mainWorktreePath}.`,
  );
}

function ensureLocalSqliteFile() {
  ensureWorktreeStateSeededFromMain();

  const existingSqlitePath = findLocalSqliteFile();

  if (existingSqlitePath) {
    return existingSqlitePath;
  }

  runCommand(
    ["bun", "run", "db:migrate:local"],
    "Applying local D1 migrations",
  );

  const migratedSqlitePath = findLocalSqliteFile();

  if (migratedSqlitePath) {
    return migratedSqlitePath;
  }

  throw new Error(
    "Unable to locate the local D1 SQLite file after running migrations. Run `bun run dev` or `bun run dev:worktree` once and try again.",
  );
}

async function main() {
  const sqlitePath = ensureLocalSqliteFile();

  logStep(`Using local D1 database at ${path.relative(rootDir, sqlitePath)}.`);

  const child = Bun.spawn(
    [
      drizzleKitBin,
      "studio",
      "--config",
      studioConfigPath,
      ...process.argv.slice(2),
    ],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        VISTA_LOCAL_D1_SQLITE_PATH: sqlitePath,
      },
      stderr: "inherit",
      stdin: "inherit",
      stdout: "inherit",
    },
  );

  process.exit(await child.exited);
}

await main();
