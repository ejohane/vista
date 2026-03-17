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

async function runCommand(command: string[]) {
  const child = Bun.spawn(command, {
    cwd: rootDir,
    stderr: "inherit",
    stdout: "inherit",
  });

  const exitCode = await child.exited;

  if (exitCode !== 0) {
    throw new Error(`command failed with exit code ${exitCode}`);
  }
}

async function main() {
  const topLevel = await getCommandOutput([
    "git",
    "rev-parse",
    "--show-toplevel",
  ]).catch(() => "");

  if (!topLevel) {
    console.log("[prepare] Skipping Git hook setup outside a Git repository.");
    return;
  }

  if (path.resolve(topLevel) !== rootDir) {
    console.log("[prepare] Skipping Git hook setup outside the repo root.");
    return;
  }

  try {
    const expectedHooksPath = path.join(rootDir, ".githooks");
    const gitDir = await getCommandOutput(["git", "rev-parse", "--git-dir"]);
    const gitCommonDir = await getCommandOutput([
      "git",
      "rev-parse",
      "--git-common-dir",
    ]);
    const useWorktreeConfig =
      path.resolve(rootDir, gitDir) !== path.resolve(rootDir, gitCommonDir) &&
      (await getCommandOutput([
        "git",
        "config",
        "--get",
        "extensions.worktreeConfig",
      ]).catch(() => "")) === "true";
    const configCommand = useWorktreeConfig
      ? ["git", "config", "--worktree"]
      : ["git", "config"];
    const hooksPath = await getCommandOutput([
      ...configCommand,
      "core.hooksPath",
    ]).catch(() => "");

    if (hooksPath === expectedHooksPath || hooksPath === ".githooks") {
      console.log("[prepare] Git hooks already configured.");
      return;
    }

    await runCommand([...configCommand, "core.hooksPath", expectedHooksPath]);

    const sharedHooksPath = await getCommandOutput([
      "git",
      "config",
      "--local",
      "core.hooksPath",
    ]).catch(() => "");

    if (
      useWorktreeConfig &&
      (sharedHooksPath === ".githooks" || sharedHooksPath === expectedHooksPath)
    ) {
      await runCommand([
        "git",
        "config",
        "--local",
        "--unset-all",
        "core.hooksPath",
      ]);
    }

    console.log(
      `[prepare] Configured Git hooks to use ${expectedHooksPath}.${
        useWorktreeConfig ? " (worktree-local)" : ""
      }`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Git hook setup failed: ${message}`);
  }
}

await main();
