import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const webAppDir = path.join(rootDir, "apps", "web");
const reactRouterBin = path.join(
  webAppDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "react-router.cmd" : "react-router",
);
const host = process.env.VISTA_DEV_HOST?.trim() || "127.0.0.1";
const port = process.env.VISTA_WEB_PORT?.trim() || "5173";

const child = Bun.spawn(
  [
    reactRouterBin,
    "dev",
    "--host",
    host,
    "--port",
    port,
    "--strictPort",
    ...process.argv.slice(2),
  ],
  {
    cwd: webAppDir,
    env: process.env,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  },
);

process.exit(await child.exited);
