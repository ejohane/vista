import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

type ReleaseTarget = {
  assetName: string;
  bunTarget: string;
  executableName: string;
};

const version = Bun.argv[2]?.replace(/^v/, "");

if (!version) {
  throw new Error("Usage: bun run scripts/build-cli-release.ts <version>");
}

const targets: ReleaseTarget[] = [
  {
    assetName: "vista-bun-darwin-arm64.tar.gz",
    bunTarget: "bun-darwin-arm64",
    executableName: "vista",
  },
  {
    assetName: "vista-bun-darwin-x64.tar.gz",
    bunTarget: "bun-darwin-x64",
    executableName: "vista",
  },
  {
    assetName: "vista-bun-linux-arm64.tar.gz",
    bunTarget: "bun-linux-arm64",
    executableName: "vista",
  },
  {
    assetName: "vista-bun-linux-x64-baseline.tar.gz",
    bunTarget: "bun-linux-x64-baseline",
    executableName: "vista",
  },
];

const outDir = "dist/cli";
const repository = "ejohane/vista";
const installerSourcePath = "scripts/install-cli.sh";
const installerAssetName = "install.sh";

function sha256(path: string) {
  const digest = new Bun.CryptoHasher("sha256")
    .update(readFileSync(path))
    .digest("hex");

  return digest.toString();
}

rmSync(outDir, { force: true, recursive: true });
mkdirSync(outDir, { recursive: true });
copyFileSync(installerSourcePath, join(outDir, installerAssetName));
chmodSync(join(outDir, installerAssetName), 0o755);

for (const target of targets) {
  const targetDir = join(outDir, target.bunTarget);
  const executablePath = join(targetDir, target.executableName);
  const archivePath = join(outDir, target.assetName);

  mkdirSync(targetDir, { recursive: true });

  execFileSync(
    "bun",
    [
      "build",
      "--compile",
      "--minify",
      `--target=${target.bunTarget}`,
      "--define",
      `VISTA_CLI_VERSION=${JSON.stringify(version)}`,
      "--define",
      `VISTA_CLI_REPOSITORY=${JSON.stringify(repository)}`,
      "apps/cli/src/index.ts",
      "--outfile",
      executablePath,
    ],
    { stdio: "inherit" },
  );
  chmodSync(executablePath, 0o755);
  execFileSync("tar", ["-czf", archivePath, "-C", targetDir, "vista"], {
    stdio: "inherit",
  });
  writeFileSync(
    `${archivePath}.sha256`,
    `${sha256(archivePath)}  ${target.assetName}\n`,
  );
}

writeFileSync(
  join(outDir, "manifest.json"),
  `${JSON.stringify(
    {
      assets: targets.map((target) => target.assetName),
      installer: installerAssetName,
      repository,
      version,
    },
    null,
    2,
  )}\n`,
);
