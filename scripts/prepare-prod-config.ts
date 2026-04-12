import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveProdConfigValues,
  writeProdWranglerConfig,
} from "./prod-config";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const values = resolveProdConfigValues();
const outputPaths = [
  writeProdWranglerConfig({
    outputRelativePath: "apps/web/wrangler.prod.jsonc",
    rootDir,
    sourceRelativePath: "apps/web/wrangler.jsonc",
    values,
  }),
  writeProdWranglerConfig({
    outputRelativePath: "apps/sync/wrangler.prod.jsonc",
    rootDir,
    sourceRelativePath: "apps/sync/wrangler.jsonc",
    values,
  }),
];

for (const outputPath of outputPaths) {
  console.log(`[prod-config] wrote ${path.relative(rootDir, outputPath)}`);
}
