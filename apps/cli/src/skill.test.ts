import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  installVistaSkill,
  resolveVistaSkillPath,
  VISTA_SKILL_CONTENT,
} from "./skill";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "vista-skill-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("Vista CLI skill", () => {
  test("installs the bundled skill under the Codex skills directory", () => {
    const codexHome = makeTempDir();
    const skillFilePath = installVistaSkill({ codexHome });

    expect(skillFilePath).toBe(
      join(codexHome, "skills", "vista-cli", "SKILL.md"),
    );
    expect(existsSync(skillFilePath)).toBe(true);
    expect(readFileSync(skillFilePath, "utf8")).toBe(VISTA_SKILL_CONTENT);
  });

  test("resolves the skill directory from an explicit Codex home", () => {
    const codexHome = makeTempDir();

    expect(resolveVistaSkillPath({ codexHome })).toBe(
      join(codexHome, "skills", "vista-cli"),
    );
  });
});
