import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveDevPort } from "./dev-ports";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const wranglerBin = path.join(
  rootDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler",
);
const webAppDir = path.join(rootDir, "apps", "web");
const syncAppDir = path.join(rootDir, "apps", "sync");
const reactRouterBin = path.join(
  webAppDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "react-router.cmd" : "react-router",
);
const syncWranglerBin = path.join(
  syncAppDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler",
);
const host = "127.0.0.1";
const defaultWebPort = 5173;
const defaultSyncPort = 8788;
const shouldSkipSeed =
  process.argv.includes("--skip-seed") || process.env.VISTA_SKIP_SEED === "1";

type RunningProcess = {
  label: string;
  process: Bun.Subprocess<"ignore", "inherit", "inherit">;
};

function logStep(message: string) {
  console.log(`\n[dev] ${message}`);
}

async function runCommand(command: string[], label: string) {
  logStep(label);

  const child = Bun.spawn(command, {
    cwd: rootDir,
    stderr: "inherit",
    stdout: "inherit",
  });

  const exitCode = await child.exited;

  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}.`);
  }
}

async function querySeedStatus() {
  const child = Bun.spawn(
    [
      wranglerBin,
      "d1",
      "execute",
      "vista-dev",
      "--local",
      "--config",
      "apps/web/wrangler.jsonc",
      "--json",
      "--command",
      "SELECT (SELECT COUNT(*) FROM households) AS householdCount, (SELECT COUNT(*) FROM accounts) AS accountCount;",
    ],
    {
      cwd: rootDir,
      stderr: "inherit",
      stdout: "pipe",
    },
  );

  const stdout = await new Response(child.stdout).text();
  const exitCode = await child.exited;

  if (exitCode !== 0) {
    throw new Error(`Local D1 query failed with exit code ${exitCode}.`);
  }

  const parsed = JSON.parse(stdout) as Array<{
    results?: Array<{
      accountCount?: number | string;
      householdCount?: number | string;
    }>;
  }>;
  const result = parsed[0]?.results?.[0];

  return {
    accountCount: Number(result?.accountCount ?? 0),
    householdCount: Number(result?.householdCount ?? 0),
  };
}

async function ensureLocalDbReady() {
  await runCommand(["bun", "run", "cf-typegen"], "Generating Cloudflare types");
  await runCommand(
    ["bun", "run", "db:migrate:local"],
    "Applying local D1 migrations",
  );

  const { accountCount, householdCount } = await querySeedStatus();

  if (householdCount > 0 && accountCount > 0) {
    logStep(
      `Local D1 already has data (${householdCount} household row, ${accountCount} account row found).`,
    );
    return;
  }

  if (shouldSkipSeed) {
    logStep("Leaving local D1 empty for provider onboarding.");
    return;
  }

  await runCommand(["bun", "run", "db:seed:local"], "Seeding local D1");
}

function spawnService(
  label: string,
  command: string[],
  cwd = rootDir,
): RunningProcess {
  const child = Bun.spawn(command, {
    cwd,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });

  return { label, process: child };
}

async function main() {
  await ensureLocalDbReady();

  const webPort = await resolveDevPort({
    defaultPort: defaultWebPort,
    envValue: process.env.VISTA_WEB_PORT,
    host,
    label: "web",
  });
  const syncPort = await resolveDevPort({
    defaultPort: defaultSyncPort,
    envValue: process.env.VISTA_SYNC_PORT,
    host,
    label: "sync",
  });

  logStep("Starting development services");
  if (webPort.usedFallback) {
    console.log(
      `[dev] Web port ${defaultWebPort} is busy, using ${webPort.port} instead.`,
    );
  }
  if (syncPort.usedFallback) {
    console.log(
      `[dev] Sync port ${defaultSyncPort} is busy, using ${syncPort.port} instead.`,
    );
  }
  console.log(`[dev] Web:  http://${host}:${webPort.port}`);
  console.log(`[dev] Sync: http://${host}:${syncPort.port}`);

  const services = [
    spawnService(
      "web",
      [
        reactRouterBin,
        "dev",
        "--host",
        host,
        "--port",
        String(webPort.port),
        "--strictPort",
      ],
      webAppDir,
    ),
    spawnService(
      "sync",
      [
        syncWranglerBin,
        "dev",
        "--test-scheduled",
        "--port",
        String(syncPort.port),
        "--persist-to",
        "../web/.wrangler/state",
      ],
      syncAppDir,
    ),
  ];

  let shuttingDown = false;

  const stopAll = async (signal: NodeJS.Signals | "exit") => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`\n[dev] Stopping services (${signal})`);

    for (const service of services) {
      service.process.kill("SIGTERM");
    }

    await Promise.all(services.map((service) => service.process.exited));
  };

  process.on("SIGINT", async () => {
    await stopAll("SIGINT");
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await stopAll("SIGTERM");
    process.exit(0);
  });

  const firstExit = await Promise.race(
    services.map(async (service) => ({
      code: await service.process.exited,
      label: service.label,
    })),
  );

  await stopAll("exit");

  if (firstExit.code !== 0) {
    throw new Error(
      `${firstExit.label} exited unexpectedly with code ${firstExit.code}.`,
    );
  }
}

await main();
