import { formatIsoTimestamp, printJson } from "./json-output";
import type { LocalD1Database } from "./local-d1";

export type IncomeCommand =
  | {
      bonusMinor: number;
      effectiveDate: string;
      householdId?: string;
      kind: "set";
      note?: string;
      personName: string;
      salaryMinor: number;
      source: string;
    }
  | {
      householdId?: string;
      json: boolean;
      kind: "show";
      personName?: string;
    }
  | {
      all: boolean;
      householdId?: string;
      kind: "clear";
      personName?: string;
      source?: string;
    };

type HouseholdRow = {
  id: string;
};

type HouseholdCountRow = {
  count: number;
};

export type IncomeProfileRow = {
  bonusMinor: number;
  currency: string;
  effectiveDate: string;
  id: string;
  note: null | string;
  personName: string;
  salaryMinor: number;
  source: string;
  updatedAt: number;
};

function formatUsd(minor: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(minor / 100);
}

function pad(value: string, length: number) {
  return value.padEnd(length, " ");
}

function parseAmountMinor(value: string | undefined, option: string) {
  const normalized = value?.replaceAll(",", "").replace(/^\$/, "").trim();

  if (!normalized) {
    throw new Error(`${option} is required.`);
  }

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${option} must be a positive dollar amount.`);
  }

  const [dollars = "0", cents = ""] = normalized.split(".");
  const amountMinor =
    Number.parseInt(dollars, 10) * 100 +
    Number.parseInt(cents.padEnd(2, "0") || "0", 10);

  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error(`${option} must be a positive dollar amount.`);
  }

  return amountMinor;
}

function parseOptionalAmountMinor(value: string | undefined, option: string) {
  if (value === undefined) {
    return 0;
  }

  return parseAmountMinor(value, option);
}

function parseDate(value: string | undefined) {
  const date = value ?? new Date().toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("--effective-date must use YYYY-MM-DD.");
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new Error("--effective-date must be a valid YYYY-MM-DD date.");
  }

  return date;
}

function readOption(argv: string[], index: number, option: string) {
  const value = argv[index + 1];

  if (!value) {
    throw new Error(`${option} requires a value.`);
  }

  return value;
}

function requireTrimmed(value: string | undefined, option: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new Error(`${option} is required.`);
  }

  return trimmed;
}

export function parseIncomeArgs(argv: string[]): IncomeCommand {
  const [command = "show", ...rest] = argv;

  if (command === "set") {
    const values: {
      bonus?: string;
      effectiveDate?: string;
      householdId?: string;
      note?: string;
      person?: string;
      salary?: string;
      source?: string;
    } = {};

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];

      if (arg === "--person") {
        values.person = readOption(rest, index, arg);
        index += 1;
        continue;
      }

      if (arg === "--source") {
        values.source = readOption(rest, index, arg);
        index += 1;
        continue;
      }

      if (arg === "--salary") {
        values.salary = readOption(rest, index, arg);
        index += 1;
        continue;
      }

      if (arg === "--bonus") {
        values.bonus = readOption(rest, index, arg);
        index += 1;
        continue;
      }

      if (arg === "--effective-date") {
        values.effectiveDate = readOption(rest, index, arg);
        index += 1;
        continue;
      }

      if (arg === "--note") {
        values.note = readOption(rest, index, arg);
        index += 1;
        continue;
      }

      if (arg === "--household-id") {
        values.householdId = readOption(rest, index, arg);
        index += 1;
        continue;
      }

      throw new Error(`Unknown income set option: ${arg}`);
    }

    const salaryMinor = parseAmountMinor(values.salary, "--salary");
    const bonusMinor = parseOptionalAmountMinor(values.bonus, "--bonus");

    if (salaryMinor + bonusMinor <= 0) {
      throw new Error("Income must include salary or bonus.");
    }

    return {
      bonusMinor,
      effectiveDate: parseDate(values.effectiveDate),
      householdId: values.householdId?.trim() || undefined,
      kind: "set",
      note: values.note?.trim() || undefined,
      personName: requireTrimmed(values.person, "--person"),
      salaryMinor,
      source: requireTrimmed(values.source, "--source"),
    };
  }

  if (command === "show" || command === "summary" || command === "list") {
    const options = parseFilterOptions(rest, `income ${command}`, false, true);

    return {
      householdId: options.householdId,
      json: options.json,
      kind: "show",
      personName: options.personName,
    };
  }

  if (command === "clear" || command === "delete" || command === "remove") {
    const options = parseFilterOptions(rest, `income ${command}`, true);

    if (!options.all && (!options.personName || !options.source)) {
      throw new Error(
        `Usage: vista income ${command} --person "Name" --source "Employer"`,
      );
    }

    return {
      all: options.all,
      householdId: options.householdId,
      kind: "clear",
      personName: options.personName,
      source: options.source,
    };
  }

  throw new Error(`Unknown income command: ${command}`);
}

function parseFilterOptions(
  argv: string[],
  commandName: string,
  allowAll = false,
  allowJson = false,
) {
  const options: {
    all: boolean;
    householdId?: string;
    json: boolean;
    personName?: string;
    source?: string;
  } = {
    all: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--person") {
      options.personName = readOption(argv, index, arg).trim();
      index += 1;
      continue;
    }

    if (arg === "--source") {
      options.source = readOption(argv, index, arg).trim();
      index += 1;
      continue;
    }

    if (arg === "--household-id") {
      options.householdId = readOption(argv, index, arg).trim();
      index += 1;
      continue;
    }

    if (allowAll && arg === "--all") {
      options.all = true;
      continue;
    }

    if (allowJson && arg === "--json") {
      options.json = true;
      continue;
    }

    throw new Error(`Unknown ${commandName} option: ${arg}`);
  }

  return options;
}

async function resolveHouseholdId(
  database: LocalD1Database,
  requestedHouseholdId?: string,
) {
  if (requestedHouseholdId) {
    const household = await database
      .prepare("select id from households where id = ? limit 1")
      .bind(requestedHouseholdId)
      .first<HouseholdRow>();

    if (!household) {
      throw new Error(`Household ${requestedHouseholdId} could not be found.`);
    }

    return household.id;
  }

  const countRow = await database
    .prepare("select count(*) as count from households")
    .first<HouseholdCountRow>();
  const count = Number(countRow?.count ?? 0);

  if (count === 0) {
    throw new Error(
      "No household exists yet. Connect Plaid before adding income.",
    );
  }

  if (count > 1) {
    throw new Error("Multiple households exist. Pass --household-id.");
  }

  const household = await database
    .prepare("select id from households order by created_at asc limit 1")
    .first<HouseholdRow>();

  if (!household) {
    throw new Error("The household registry is out of sync.");
  }

  return household.id;
}

function createIncomeProfileId() {
  return `income_${crypto.randomUUID()}`;
}

export async function setIncomeProfile(
  database: LocalD1Database,
  command: Extract<IncomeCommand, { kind: "set" }>,
) {
  const householdId = await resolveHouseholdId(database, command.householdId);
  const now = Date.now();

  await database
    .prepare(
      `
        insert into income_profiles (
          id,
          household_id,
          person_name,
          source,
          salary_minor,
          bonus_minor,
          currency,
          effective_date,
          note,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?)
        on conflict(household_id, person_name, source) do update set
          salary_minor = excluded.salary_minor,
          bonus_minor = excluded.bonus_minor,
          effective_date = excluded.effective_date,
          note = excluded.note,
          updated_at = excluded.updated_at
      `,
    )
    .bind(
      createIncomeProfileId(),
      householdId,
      command.personName,
      command.source,
      command.salaryMinor,
      command.bonusMinor,
      command.effectiveDate,
      command.note ?? null,
      now,
      now,
    )
    .run();

  const profiles = await listIncomeProfiles(database, {
    householdId,
    personName: command.personName,
    source: command.source,
  });

  return profiles[0] ?? null;
}

export async function listIncomeProfiles(
  database: LocalD1Database,
  options: {
    householdId?: string;
    personName?: string;
    source?: string;
  } = {},
) {
  const householdId = await resolveHouseholdId(database, options.householdId);
  const conditions = ["household_id = ?"];
  const params: string[] = [householdId];

  if (options.personName) {
    conditions.push("person_name = ?");
    params.push(options.personName);
  }

  if (options.source) {
    conditions.push("source = ?");
    params.push(options.source);
  }

  const rows = await database
    .prepare(
      `
        select
          id,
          person_name as personName,
          source,
          salary_minor as salaryMinor,
          bonus_minor as bonusMinor,
          currency,
          effective_date as effectiveDate,
          note,
          updated_at as updatedAt
        from income_profiles
        where ${conditions.join(" and ")}
        order by person_name asc, source asc
      `,
    )
    .bind(...params)
    .all<IncomeProfileRow>();

  return rows.results;
}

export async function clearIncomeProfiles(
  database: LocalD1Database,
  command: Extract<IncomeCommand, { kind: "clear" }>,
) {
  const householdId = await resolveHouseholdId(database, command.householdId);
  const conditions = ["household_id = ?"];
  const params: string[] = [householdId];

  if (!command.all) {
    if (!command.personName || !command.source) {
      throw new Error("Pass --person and --source, or pass --all.");
    }

    conditions.push("person_name = ?", "source = ?");
    params.push(command.personName, command.source);
  }

  const result = await database
    .prepare(`delete from income_profiles where ${conditions.join(" and ")}`)
    .bind(...params)
    .run();

  return result.meta.changes ?? 0;
}

export async function runIncomeCommand(
  database: LocalD1Database,
  command: IncomeCommand,
) {
  if (command.kind === "set") {
    const profile = await setIncomeProfile(database, command);

    if (!profile) {
      throw new Error("Income profile was not saved.");
    }

    console.log("Saved income profile.");
    printIncomeProfiles([profile]);
    return;
  }

  if (command.kind === "clear") {
    const deletedCount = await clearIncomeProfiles(database, command);
    console.log(
      `Cleared ${deletedCount} income profile${deletedCount === 1 ? "" : "s"}.`,
    );
    return;
  }

  const profiles = await listIncomeProfiles(database, command);

  if (command.json) {
    printIncomeProfilesJson(profiles);
    return;
  }

  if (profiles.length === 0) {
    console.log("No income profiles found.");
    return;
  }

  printIncomeProfiles(profiles);
}

export function toIncomeProfilesJson(profiles: IncomeProfileRow[]) {
  const totals = profiles.reduce(
    (summary, profile) => {
      summary.salaryMinor += profile.salaryMinor;
      summary.bonusMinor += profile.bonusMinor;
      return summary;
    },
    {
      bonusMinor: 0,
      salaryMinor: 0,
    },
  );
  const annualMinor = totals.salaryMinor + totals.bonusMinor;

  return {
    profiles: profiles.map((profile) => {
      const profileAnnualMinor = profile.salaryMinor + profile.bonusMinor;

      return {
        annualMinor: profileAnnualMinor,
        bonusMinor: profile.bonusMinor,
        currency: profile.currency,
        effectiveDate: profile.effectiveDate,
        id: profile.id,
        monthlyGrossMinor: Math.round(profileAnnualMinor / 12),
        note: profile.note,
        personName: profile.personName,
        salaryMinor: profile.salaryMinor,
        source: profile.source,
        updatedAt: formatIsoTimestamp(profile.updatedAt),
      };
    }),
    schemaVersion: 1,
    totals: {
      annualMinor,
      bonusMinor: totals.bonusMinor,
      currency: "USD",
      monthlyGrossMinor: Math.round(annualMinor / 12),
      salaryMinor: totals.salaryMinor,
    },
  };
}

export function printIncomeProfilesJson(profiles: IncomeProfileRow[]) {
  printJson(toIncomeProfilesJson(profiles));
}

export function printIncomeProfiles(profiles: IncomeProfileRow[]) {
  const totals = profiles.reduce(
    (summary, profile) => {
      summary.salaryMinor += profile.salaryMinor;
      summary.bonusMinor += profile.bonusMinor;
      return summary;
    },
    {
      bonusMinor: 0,
      salaryMinor: 0,
    },
  );
  const annualMinor = totals.salaryMinor + totals.bonusMinor;

  console.log("Income profiles");
  console.log(`Profiles:      ${profiles.length}`);
  console.log(`Salary:        ${formatUsd(totals.salaryMinor)}`);
  console.log(`Bonus:         ${formatUsd(totals.bonusMinor)}`);
  console.log(`Annual total:  ${formatUsd(annualMinor)}`);
  console.log(`Monthly gross: ${formatUsd(Math.round(annualMinor / 12))}`);
  console.log("");
  console.log(
    [
      pad("Person", 18),
      pad("Source", 24),
      pad("Salary", 14),
      pad("Bonus", 13),
      pad("Annual", 14),
      pad("Monthly", 13),
      pad("Effective", 12),
      "ID",
    ].join(""),
  );
  console.log("-".repeat(122));

  for (const profile of profiles) {
    const profileAnnualMinor = profile.salaryMinor + profile.bonusMinor;

    console.log(
      [
        pad(profile.personName.slice(0, 17), 18),
        pad(profile.source.slice(0, 23), 24),
        pad(formatUsd(profile.salaryMinor), 14),
        pad(formatUsd(profile.bonusMinor), 13),
        pad(formatUsd(profileAnnualMinor), 14),
        pad(formatUsd(Math.round(profileAnnualMinor / 12)), 13),
        pad(profile.effectiveDate, 12),
        profile.id.slice(0, 20),
      ].join(""),
    );
  }
}

export function printIncomeHelp() {
  console.log(`Vista income commands

Usage:
  vista income set --person "Erik" --source "Employer" --salary 150000 [--bonus 25000] [--effective-date YYYY-MM-DD] [--note "..."]
  vista income show [--person "Erik"] [--json]
  vista income clear --person "Erik" --source "Employer"
  vista income clear --all
`);
}
