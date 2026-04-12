import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const stateAppDir = path.join(rootDir, "apps", "state");
const wranglerBin = path.join(
  stateAppDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler",
);
const host = process.env.VISTA_DEV_HOST?.trim() || "127.0.0.1";
const port = process.env.VISTA_STATE_PORT?.trim() || "8789";

const child = Bun.spawn(
  [
    wranglerBin,
    "dev",
    "--ip",
    host,
    "--port",
    port,
    "--persist-to",
    "../web/.wrangler/state",
    ...process.argv.slice(2),
  ],
  {
    cwd: stateAppDir,
    env: process.env,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  },
);

process.exit(await child.exited);
