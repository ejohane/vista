import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clearIncomeProfiles,
  listIncomeProfiles,
  parseIncomeArgs,
  setIncomeProfile,
} from "./income";
import { openLocalD1Database } from "./local-d1";
import { ensureLocalSchema } from "./schema";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "vista-income-test-"));
  tempDirs.push(dir);
  return dir;
}

async function makeDatabase() {
  const database = openLocalD1Database(join(makeTempDir(), "vista.sqlite"));
  await ensureLocalSchema(database);
  await database
    .prepare(
      `
        insert into households (id, name, last_synced_at, created_at)
        values (?, ?, ?, ?)
      `,
    )
    .bind("household_demo", "Vista Household", 0, 0)
    .run();

  return database;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("income CLI", () => {
  test("parses person-scoped compensation arguments", () => {
    expect(
      parseIncomeArgs([
        "set",
        "--person",
        "Erik",
        "--source",
        "Employer",
        "--salary",
        "$150,000",
        "--bonus",
        "25000.50",
        "--effective-date",
        "2026-05-01",
      ]),
    ).toEqual({
      bonusMinor: 2_500_050,
      effectiveDate: "2026-05-01",
      householdId: undefined,
      kind: "set",
      note: undefined,
      personName: "Erik",
      salaryMinor: 15_000_000,
      source: "Employer",
    });
  });

  test("sets multiple income profiles and filters them by person", async () => {
    const database = await makeDatabase();

    try {
      await setIncomeProfile(database, {
        bonusMinor: 2_500_000,
        effectiveDate: "2026-05-01",
        kind: "set",
        personName: "Erik",
        salaryMinor: 15_000_000,
        source: "Employer",
      });
      await setIncomeProfile(database, {
        bonusMinor: 1_000_000,
        effectiveDate: "2026-05-01",
        kind: "set",
        personName: "Partner",
        salaryMinor: 12_000_000,
        source: "Employer",
      });
      await setIncomeProfile(database, {
        bonusMinor: 0,
        effectiveDate: "2026-06-01",
        kind: "set",
        personName: "Erik",
        salaryMinor: 2_000_000,
        source: "Consulting",
      });

      const profiles = await listIncomeProfiles(database);

      expect(profiles).toHaveLength(3);
      expect(profiles.map((profile) => profile.personName)).toEqual([
        "Erik",
        "Erik",
        "Partner",
      ]);

      const erikProfiles = await listIncomeProfiles(database, {
        personName: "Erik",
      });

      expect(erikProfiles).toHaveLength(2);
      expect(
        erikProfiles.reduce(
          (sum, profile) => sum + profile.salaryMinor + profile.bonusMinor,
          0,
        ),
      ).toBe(19_500_000);
    } finally {
      database.close();
    }
  });

  test("updates and clears an income profile by person and source", async () => {
    const database = await makeDatabase();

    try {
      await setIncomeProfile(database, {
        bonusMinor: 2_500_000,
        effectiveDate: "2026-05-01",
        kind: "set",
        personName: "Erik",
        salaryMinor: 15_000_000,
        source: "Employer",
      });
      await setIncomeProfile(database, {
        bonusMinor: 3_000_000,
        effectiveDate: "2026-06-01",
        kind: "set",
        note: "Promotion",
        personName: "Erik",
        salaryMinor: 16_000_000,
        source: "Employer",
      });

      expect(await listIncomeProfiles(database)).toMatchObject([
        {
          bonusMinor: 3_000_000,
          effectiveDate: "2026-06-01",
          note: "Promotion",
          personName: "Erik",
          salaryMinor: 16_000_000,
          source: "Employer",
        },
      ]);

      const deletedCount = await clearIncomeProfiles(database, {
        all: false,
        kind: "clear",
        personName: "Erik",
        source: "Employer",
      });

      expect(deletedCount).toBe(1);
      expect(await listIncomeProfiles(database)).toEqual([]);
    } finally {
      database.close();
    }
  });
});
