import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type PlaidEnvironment = "development" | "production" | "sandbox";

export type CliConfig = {
  databasePath: string;
  plaidClientId?: string;
  plaidEnvironment?: PlaidEnvironment;
  plaidRedirectUri?: string;
  plaidSecret?: string;
  providerTokenEncryptionKey?: string;
};

type ConfigFile = Partial<{
  databasePath: string;
  plaidClientId: string;
  plaidEnvironment: PlaidEnvironment;
  plaidRedirectUri: string;
  plaidSecret: string;
  providerTokenEncryptionKey: string;
}>;

export const VISTA_HOME = join(homedir(), ".vista");
export const CONFIG_PATH = join(VISTA_HOME, "config.json");
export const DEFAULT_DATABASE_PATH = join(VISTA_HOME, "vista.sqlite");

function parseDotenv(contents: string) {
  const values = new Map<string, string>();

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values.set(key, value);
  }

  return values;
}

function findRepoRoot(startDirectory: string) {
  let currentDirectory = resolve(startDirectory);

  while (true) {
    const packageJsonPath = join(currentDirectory, "package.json");

    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(
          readFileSync(packageJsonPath, "utf8"),
        ) as { name?: string } | null;

        if (packageJson?.name === "vista") {
          return currentDirectory;
        }
      } catch {
        // Keep walking upward if this is not the workspace root.
      }
    }

    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      return null;
    }

    currentDirectory = parentDirectory;
  }
}

function readEnvFiles() {
  const values = new Map<string, string>();
  const repoRoot = findRepoRoot(process.cwd());
  const candidateRoots = repoRoot
    ? Array.from(
        new Set(
          [repoRoot, findMainWorktree(repoRoot)].filter(
            (root): root is string => Boolean(root),
          ),
        ),
      )
    : [];
  const candidatePaths = candidateRoots.flatMap((root) => [
    join(root, ".env"),
    join(root, ".env.local"),
    join(root, "apps/web/.dev.vars"),
    join(root, "apps/sync/.dev.vars"),
  ]);

  for (const candidatePath of candidatePaths) {
    if (!existsSync(candidatePath)) {
      continue;
    }

    for (const [key, value] of parseDotenv(
      readFileSync(candidatePath, "utf8"),
    )) {
      values.set(key, value);
    }
  }

  return values;
}

function findMainWorktree(repoRoot: string) {
  try {
    const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const firstWorktreeLine = output
      .split(/\r?\n/)
      .find((line) => line.startsWith("worktree "));

    return firstWorktreeLine?.slice("worktree ".length).trim() || null;
  } catch {
    return null;
  }
}

function readConfigFile(): ConfigFile {
  if (!existsSync(CONFIG_PATH)) {
    return {};
  }

  return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as ConfigFile;
}

function readSetting(
  envFileValues: Map<string, string>,
  key: string,
  configValue?: string,
) {
  return (
    process.env[key]?.trim() || envFileValues.get(key)?.trim() || configValue
  );
}

function normalizePlaidEnvironment(
  value: string | undefined,
): PlaidEnvironment | undefined {
  if (
    value === "development" ||
    value === "production" ||
    value === "sandbox"
  ) {
    return value;
  }

  if (value) {
    throw new Error(
      `PLAID_ENV must be one of development, production, or sandbox. Received ${value}.`,
    );
  }

  return undefined;
}

export function loadCliConfig(): CliConfig {
  const envFileValues = readEnvFiles();
  const configFile = readConfigFile();

  return {
    databasePath:
      readSetting(
        envFileValues,
        "VISTA_CLI_DATABASE_PATH",
        configFile.databasePath,
      ) ?? DEFAULT_DATABASE_PATH,
    plaidClientId: readSetting(
      envFileValues,
      "PLAID_CLIENT_ID",
      configFile.plaidClientId,
    ),
    plaidEnvironment:
      normalizePlaidEnvironment(
        readSetting(envFileValues, "PLAID_ENV", configFile.plaidEnvironment),
      ) ?? "sandbox",
    plaidRedirectUri: readSetting(
      envFileValues,
      "PLAID_REDIRECT_URI",
      configFile.plaidRedirectUri,
    ),
    plaidSecret: readSetting(
      envFileValues,
      "PLAID_SECRET",
      configFile.plaidSecret,
    ),
    providerTokenEncryptionKey: readSetting(
      envFileValues,
      "PROVIDER_TOKEN_ENCRYPTION_KEY",
      configFile.providerTokenEncryptionKey,
    ),
  };
}

function createProviderTokenEncryptionKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    "",
  );

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

export function initializeCliConfig() {
  mkdirSync(VISTA_HOME, { recursive: true });

  const configAlreadyExisted = existsSync(CONFIG_PATH);
  const existingConfig = readConfigFile();
  const nextConfig: ConfigFile = {
    ...existingConfig,
    databasePath: existingConfig.databasePath ?? DEFAULT_DATABASE_PATH,
    plaidEnvironment: existingConfig.plaidEnvironment ?? "sandbox",
    providerTokenEncryptionKey:
      existingConfig.providerTokenEncryptionKey ??
      createProviderTokenEncryptionKey(),
  };

  writeFileSync(
    `${CONFIG_PATH}.tmp`,
    `${JSON.stringify(nextConfig, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
  renameSync(`${CONFIG_PATH}.tmp`, CONFIG_PATH);

  return {
    config: nextConfig,
    created: !configAlreadyExisted,
  };
}
