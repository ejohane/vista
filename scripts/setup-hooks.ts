import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function getCommandOutput(command: string[]) {
  const child = Bun.spawn(command, {
    cwd: rootDir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || "command failed");
  }

  return stdout.trim();
}

async function main() {
  try {
    const topLevel = await getCommandOutput([
      "git",
      "rev-parse",
      "--show-toplevel",
    ]);

    if (path.resolve(topLevel) !== rootDir) {
      console.log("[prepare] Skipping Git hook setup outside the repo root.");
      return;
    }

    const hooksPath = await getCommandOutput([
      "git",
      "config",
      "core.hooksPath",
    ]).catch(() => "");

    if (hooksPath === ".githooks") {
      console.log("[prepare] Git hooks already configured.");
      return;
    }

    const configChild = Bun.spawn(
      ["git", "config", "core.hooksPath", ".githooks"],
      {
        cwd: rootDir,
        stderr: "inherit",
        stdout: "inherit",
      },
    );

    const exitCode = await configChild.exited;

    if (exitCode !== 0) {
      throw new Error(`git config exited with code ${exitCode}`);
    }

    console.log("[prepare] Configured Git hooks to use .githooks.");
  } catch (error) {
    console.log(
      `[prepare] Skipping Git hook setup: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

await main();
