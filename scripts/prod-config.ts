import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const PROD_DATABASE_ID_PLACEHOLDER = "__VISTA_PROD_D1_DATABASE_ID__";
export const PROD_PREVIEW_DATABASE_ID_PLACEHOLDER =
  "__VISTA_PROD_PREVIEW_D1_DATABASE_ID__";

export type ProdConfigValues = {
  databaseId: string;
  previewDatabaseId: string;
};

export function resolveProdConfigValues(
  env: NodeJS.ProcessEnv = process.env,
): ProdConfigValues {
  const databaseId = env.VISTA_PROD_D1_DATABASE_ID?.trim();

  if (!databaseId) {
    throw new Error(
      "VISTA_PROD_D1_DATABASE_ID is required to generate production Wrangler config.",
    );
  }

  return {
    databaseId,
    previewDatabaseId:
      env.VISTA_PROD_PREVIEW_D1_DATABASE_ID?.trim() || databaseId,
  };
}

export function materializeProdWranglerConfig(
  source: string,
  values: ProdConfigValues,
) {
  return source
    .replaceAll(PROD_DATABASE_ID_PLACEHOLDER, values.databaseId)
    .replaceAll(PROD_PREVIEW_DATABASE_ID_PLACEHOLDER, values.previewDatabaseId);
}

export function writeProdWranglerConfig(args: {
  outputRelativePath: string;
  rootDir: string;
  sourceRelativePath: string;
  values?: ProdConfigValues;
}) {
  const sourcePath = path.join(args.rootDir, args.sourceRelativePath);
  const outputPath = path.join(args.rootDir, args.outputRelativePath);
  const values = args.values ?? resolveProdConfigValues();
  const source = readFileSync(sourcePath, "utf8");
  const rendered = materializeProdWranglerConfig(source, values);

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, rendered, "utf8");

  return outputPath;
}
