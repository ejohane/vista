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
        PLAID_CLIENT_ID=client-demo
        PLAID_SECRET="secret-demo"
        export VISTA_SKIP_SEED='1'
      `),
    ).toEqual({
      PLAID_CLIENT_ID: "client-demo",
      PLAID_SECRET: "secret-demo",
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
        PLAID_CLIENT_ID: "client-demo",
        PLAID_SECRET: "secret-demo",
      }),
    ).toBe('PLAID_CLIENT_ID="client-demo"\nPLAID_SECRET="secret-demo"');
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
        PLAID_CLIENT_ID: "client-demo",
        PLAID_SECRET: "secret-demo",
      },
    });

    const targetAFile = path.join(targetA, ".dev.vars");
    const targetBFile = path.join(targetB, ".dev.vars");

    expect(readFileSync(targetAFile, "utf8")).toContain(
      'PLAID_CLIENT_ID="client-demo"',
    );
    expect(readFileSync(targetBFile, "utf8")).toContain(
      'PLAID_SECRET="secret-demo"',
    );

    rmSync(tempRoot, { force: true, recursive: true });
  });

  test("removes stale generated files when no values remain", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "vista-local-env-"));
    const targetDir = path.join(tempRoot, "apps", "web");

    mkdirSync(targetDir, { recursive: true });
    writeFileSync(
      path.join(targetDir, ".dev.vars"),
      'PLAID_CLIENT_ID="stale"\n',
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
