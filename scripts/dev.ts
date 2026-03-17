import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

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

async function queryHouseholdCount() {
  const child = Bun.spawn(
    [
      "bunx",
      "wrangler",
      "d1",
      "execute",
      "vista-dev",
      "--local",
      "--config",
      "apps/web/wrangler.jsonc",
      "--json",
      "--command",
      "SELECT COUNT(*) AS count FROM households;",
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
    results?: Array<{ count?: number | string }>;
  }>;
  const count = parsed[0]?.results?.[0]?.count;

  return Number(count ?? 0);
}

async function ensureLocalDbReady() {
  await runCommand(["bun", "run", "cf-typegen"], "Generating Cloudflare types");
  await runCommand(
    ["bun", "run", "db:migrate:local"],
    "Applying local D1 migrations",
  );

  const householdCount = await queryHouseholdCount();

  if (householdCount > 0) {
    logStep(`Local D1 already seeded (${householdCount} household row found).`);
    return;
  }

  await runCommand(["bun", "run", "db:seed:local"], "Seeding local D1");
}

function spawnService(label: string, command: string[]): RunningProcess {
  const child = Bun.spawn(command, {
    cwd: rootDir,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });

  return { label, process: child };
}

async function main() {
  await ensureLocalDbReady();

  logStep("Starting development services");
  console.log("[dev] Web:  http://127.0.0.1:5173");
  console.log("[dev] Sync: http://127.0.0.1:8788");

  const services = [
    spawnService("web", ["bun", "run", "dev:web"]),
    spawnService("sync", ["bun", "run", "dev:sync"]),
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
