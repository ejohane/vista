import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { CLI_REPOSITORY, CLI_VERSION } from "./version";

type UpgradeOptions = {
  check: boolean;
  force: boolean;
};

type GitHubRelease = {
  assets: Array<{
    browser_download_url: string;
    name: string;
  }>;
  html_url: string;
  tag_name: string;
};

const VERSION_PATTERN = /^v?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)/;

class NoPublishedReleaseError extends Error {
  constructor() {
    super("No published Vista releases found.");
  }
}

function normalizeVersion(value: string) {
  return value.trim().replace(/^v/, "");
}

function parseVersion(value: string) {
  const match = VERSION_PATTERN.exec(value);

  if (!match?.groups) {
    return null;
  }

  return {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
  };
}

function compareVersions(left: string, right: string) {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);

  if (!parsedLeft || !parsedRight) {
    return left.localeCompare(right);
  }

  return (
    parsedLeft.major - parsedRight.major ||
    parsedLeft.minor - parsedRight.minor ||
    parsedLeft.patch - parsedRight.patch
  );
}

function resolveTargetAssetName() {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "vista-bun-darwin-arm64.tar.gz";
  }

  if (process.platform === "darwin" && process.arch === "x64") {
    return "vista-bun-darwin-x64.tar.gz";
  }

  if (process.platform === "linux" && process.arch === "arm64") {
    return "vista-bun-linux-arm64.tar.gz";
  }

  if (process.platform === "linux" && process.arch === "x64") {
    return "vista-bun-linux-x64-baseline.tar.gz";
  }

  throw new Error(
    `No Vista binary release is available for ${process.platform}/${process.arch}.`,
  );
}

function isRunningFromCompiledBinary() {
  return basename(process.execPath) !== "bun";
}

function githubHeaders(extraHeaders: Record<string, string> = {}) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    "user-agent": "vista-cli",
    ...extraHeaders,
  };
}

async function readTextUrl(url: string) {
  const response = await fetch(url, {
    headers: githubHeaders({
      accept: "application/vnd.github+json",
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}.`);
  }

  return response.text();
}

async function downloadFile(url: string, path: string) {
  const response = await fetch(url, {
    headers: githubHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}.`);
  }

  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
}

async function sha256(path: string) {
  const digest = await crypto.subtle.digest("SHA-256", readFileSync(path));

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function fetchLatestRelease() {
  const url = `https://api.github.com/repos/${CLI_REPOSITORY}/releases/latest`;
  const response = await fetch(url, {
    headers: githubHeaders({
      accept: "application/vnd.github+json",
    }),
  });

  if (response.status === 404) {
    throw new NoPublishedReleaseError();
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}.`);
  }

  return (await response.json()) as GitHubRelease;
}

export function parseUpgradeArgs(argv: string[]): UpgradeOptions {
  const options: UpgradeOptions = {
    check: false,
    force: false,
  };

  for (const arg of argv) {
    if (arg === "--check") {
      options.check = true;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    throw new Error(`Unknown upgrade option: ${arg}`);
  }

  return options;
}

export async function printVersion(checkLatest: boolean) {
  console.log(`vista ${CLI_VERSION}`);

  if (!checkLatest) {
    return;
  }

  try {
    const latest = await fetchLatestRelease();
    console.log(`latest ${normalizeVersion(latest.tag_name)}`);
    console.log(latest.html_url);
  } catch (error) {
    if (error instanceof NoPublishedReleaseError) {
      console.log("latest unavailable: no published releases");
      return;
    }

    throw error;
  }
}

export async function upgradeCli(options: UpgradeOptions) {
  let latest: GitHubRelease;

  try {
    latest = await fetchLatestRelease();
  } catch (error) {
    if (options.check && error instanceof NoPublishedReleaseError) {
      console.log(`current ${normalizeVersion(CLI_VERSION)}`);
      console.log("latest  unavailable: no published releases");
      return;
    }

    throw error;
  }
  const latestVersion = normalizeVersion(latest.tag_name);
  const currentVersion = normalizeVersion(CLI_VERSION);

  if (options.check) {
    console.log(`current ${currentVersion}`);
    console.log(`latest  ${latestVersion}`);
    console.log(latest.html_url);
    return;
  }

  if (!options.force && compareVersions(currentVersion, latestVersion) >= 0) {
    console.log(`vista is already up to date (${currentVersion}).`);
    return;
  }

  if (!isRunningFromCompiledBinary()) {
    throw new Error(
      "Self-upgrade only works from a compiled Vista binary, not `bun run cli`.",
    );
  }

  const assetName = resolveTargetAssetName();
  const asset = latest.assets.find((candidate) => candidate.name === assetName);
  const checksumAsset = latest.assets.find(
    (candidate) => candidate.name === `${assetName}.sha256`,
  );

  if (!asset || !checksumAsset) {
    throw new Error(`Release ${latest.tag_name} is missing ${assetName}.`);
  }

  const workspace = mkdtempSync(join(tmpdir(), "vista-upgrade-"));
  const archivePath = join(workspace, assetName);
  const extractedBinaryPath = join(workspace, "vista");
  const targetPath = process.execPath;
  const replacementPath = `${targetPath}.new`;

  try {
    await downloadFile(asset.browser_download_url, archivePath);

    const expectedChecksum = (
      await readTextUrl(checksumAsset.browser_download_url)
    )
      .trim()
      .split(/\s+/)[0];
    const actualChecksum = await sha256(archivePath);

    if (actualChecksum !== expectedChecksum) {
      throw new Error(
        `Checksum mismatch for ${assetName}: expected ${expectedChecksum}, got ${actualChecksum}.`,
      );
    }

    execFileSync("tar", ["-xzf", archivePath, "-C", workspace]);

    if (!existsSync(extractedBinaryPath)) {
      throw new Error(`${assetName} did not contain a vista binary.`);
    }

    copyFileSync(extractedBinaryPath, replacementPath);
    chmodSync(replacementPath, 0o755);
    renameSync(replacementPath, targetPath);

    console.log(`Updated vista from ${currentVersion} to ${latestVersion}.`);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
}
