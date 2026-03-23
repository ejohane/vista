import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  formatLocalEnv,
  parseLocalEnv,
  syncCloudflareDevVarsFiles,
} from "./local-env";

describe("parseLocalEnv", () => {
  test("parses plain, quoted, and exported assignments", () => {
    expect(
      parseLocalEnv(`
        # comment
        SNAPTRADE_CLIENT_ID=client-demo
        SNAPTRADE_CONSUMER_KEY="consumer-demo"
        export VISTA_SKIP_SEED='1'
      `),
    ).toEqual({
      SNAPTRADE_CLIENT_ID: "client-demo",
      SNAPTRADE_CONSUMER_KEY: "consumer-demo",
      VISTA_SKIP_SEED: "1",
    });
  });

  test("throws on invalid lines", () => {
    expect(() => parseLocalEnv("not-an-assignment")).toThrow(
      "Invalid environment variable assignment on line 1.",
    );
  });
});

describe("formatLocalEnv", () => {
  test("renders stable quoted assignments", () => {
    expect(
      formatLocalEnv({
        SNAPTRADE_CONSUMER_KEY: "consumer-demo",
        SNAPTRADE_CLIENT_ID: "client-demo",
      }),
    ).toBe(
      'SNAPTRADE_CLIENT_ID="client-demo"\nSNAPTRADE_CONSUMER_KEY="consumer-demo"',
    );
  });
});

describe("syncCloudflareDevVarsFiles", () => {
  test("writes generated dev vars files for each target directory", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "vista-local-env-"));
    const targetA = path.join(tempRoot, "apps", "web");
    const targetB = path.join(tempRoot, "apps", "sync");

    mkdirSync(targetA, { recursive: true });
    mkdirSync(targetB, { recursive: true });

    syncCloudflareDevVarsFiles({
      sourceFileLabel: ".env.local",
      targetDirs: [targetA, targetB],
      values: {
        SNAPTRADE_CLIENT_ID: "client-demo",
        SNAPTRADE_CONSUMER_KEY: "consumer-demo",
      },
    });

    const targetAFile = path.join(targetA, ".dev.vars");
    const targetBFile = path.join(targetB, ".dev.vars");

    expect(readFileSync(targetAFile, "utf8")).toContain(
      'SNAPTRADE_CLIENT_ID="client-demo"',
    );
    expect(readFileSync(targetBFile, "utf8")).toContain(
      'SNAPTRADE_CONSUMER_KEY="consumer-demo"',
    );

    rmSync(tempRoot, { force: true, recursive: true });
  });

  test("removes stale generated files when no values remain", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "vista-local-env-"));
    const targetDir = path.join(tempRoot, "apps", "web");

    mkdirSync(targetDir, { recursive: true });
    writeFileSync(
      path.join(targetDir, ".dev.vars"),
      'SNAPTRADE_CLIENT_ID="stale"\n',
    );

    syncCloudflareDevVarsFiles({
      sourceFileLabel: ".env.local",
      targetDirs: [targetDir],
      values: {},
    });

    expect(existsSync(path.join(targetDir, ".dev.vars"))).toBe(false);

    rmSync(tempRoot, { force: true, recursive: true });
  });
});
