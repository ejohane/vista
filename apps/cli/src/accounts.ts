import { formatIsoTimestamp, printJson } from "./json-output";
import type { LocalD1Database } from "./local-d1";

const OWNERSHIP_TYPES = ["mine", "wife", "joint"] as const;

type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

export type AccountRow = {
  accountSubtype: null | string;
  accountType: string;
  balanceMinor: number;
  currency: string;
  displayName: null | string;
  id: string;
  includeInHouseholdReporting: number;
  institutionName: string;
  isHidden: number;
  name: string;
  ownershipType: OwnershipType;
  reportingGroup: "cash" | "investments" | "liabilities";
  updatedAt: number;
};

export type AccountDetailRow = AccountRow & {
  createdAt: number;
  provider: null | string;
  providerAccountId: null | string;
  providerConnectionId: null | string;
  providerNativeAccountId: null | string;
};

export type AccountCommand =
  | { kind: "help" }
  | { json: boolean; kind: "list" }
  | { accountId: string; kind: "show" }
  | { accountId: string; displayName: null | string; kind: "rename" }
  | { accountId: string; hidden: boolean; kind: "visibility" }
  | { accountId: string; included: boolean; kind: "inclusion" }
  | { accountId: string; kind: "owner"; ownershipType: OwnershipType };

const REPORTING_GROUP_LABELS = {
  cash: "Cash",
  investments: "Investments",
  liabilities: "Liabilities",
} satisfies Record<AccountRow["reportingGroup"], string>;

function formatUsd(minor: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(minor / 100);
}

function formatUpdatedAt(timestamp: number) {
  return new Date(timestamp).toISOString();
}

function pad(value: string, length: number) {
  return value.padEnd(length, " ");
}

function formatBooleanFlag(value: number) {
  return value === 1 ? "yes" : "no";
}

function parseAccountId(value: string | undefined, command: string) {
  if (!value?.trim()) {
    throw new Error(`Usage: vista accounts ${command} <id>`);
  }

  return value;
}

function requireNoExtraArgs(args: string[], usage: string) {
  const unexpectedArg = args.find(Boolean);

  if (unexpectedArg) {
    throw new Error(`Unexpected argument "${unexpectedArg}". Usage: ${usage}`);
  }
}

function isOwnershipType(value: string): value is OwnershipType {
  return OWNERSHIP_TYPES.includes(value as OwnershipType);
}

export const ACCOUNTS_HELP = `Vista account commands

Usage:
  vista accounts [--json]
  vista accounts show <id>
  vista accounts rename <id> "Display Name"
  vista accounts rename <id> --clear
  vista accounts hide <id>
  vista accounts unhide <id>
  vista accounts include <id>
  vista accounts exclude <id>
  vista accounts owner <id> --owner mine|wife|joint
`;

export function printAccountsHelp() {
  console.log(ACCOUNTS_HELP);
}

export function parseAccountsArgs(argv: string[]): AccountCommand {
  const [subcommand, accountIdArg, ...rest] = argv;

  if (!subcommand) {
    return { json: false, kind: "list" };
  }

  if (subcommand === "--json") {
    requireNoExtraArgs(
      [accountIdArg, ...rest].filter(Boolean),
      "vista accounts --json",
    );
    return { json: true, kind: "list" };
  }

  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    return { kind: "help" };
  }

  if (subcommand === "show") {
    const accountId = parseAccountId(accountIdArg, "show");
    requireNoExtraArgs(rest, "vista accounts show <id>");
    return { accountId, kind: "show" };
  }

  if (subcommand === "rename") {
    const accountId = parseAccountId(accountIdArg, "rename");

    if (rest.length === 1 && rest[0] === "--clear") {
      return { accountId, displayName: null, kind: "rename" };
    }

    if (rest.includes("--clear")) {
      throw new Error(
        'Usage: vista accounts rename <id> "Display Name" OR vista accounts rename <id> --clear',
      );
    }

    const displayName = rest.join(" ").trim();

    if (!displayName) {
      throw new Error(
        'Usage: vista accounts rename <id> "Display Name" OR vista accounts rename <id> --clear',
      );
    }

    return { accountId, displayName, kind: "rename" };
  }

  if (subcommand === "hide" || subcommand === "unhide") {
    const accountId = parseAccountId(accountIdArg, subcommand);
    requireNoExtraArgs(rest, `vista accounts ${subcommand} <id>`);
    return {
      accountId,
      hidden: subcommand === "hide",
      kind: "visibility",
    };
  }

  if (subcommand === "include" || subcommand === "exclude") {
    const accountId = parseAccountId(accountIdArg, subcommand);
    requireNoExtraArgs(rest, `vista accounts ${subcommand} <id>`);
    return {
      accountId,
      included: subcommand === "include",
      kind: "inclusion",
    };
  }

  if (subcommand === "owner") {
    const accountId = parseAccountId(accountIdArg, "owner");
    const [ownerFlag, ownerValue, ...extraArgs] = rest;

    if (
      ownerFlag !== "--owner" ||
      !ownerValue ||
      !isOwnershipType(ownerValue)
    ) {
      throw new Error(
        "Usage: vista accounts owner <id> --owner mine|wife|joint",
      );
    }

    requireNoExtraArgs(
      extraArgs,
      "vista accounts owner <id> --owner mine|wife|joint",
    );

    return {
      accountId,
      kind: "owner",
      ownershipType: ownerValue,
    };
  }

  throw new Error(`Unknown accounts command: ${subcommand}`);
}

export async function listAccounts(database: LocalD1Database) {
  const rows = await database
    .prepare(
      `
        select
          id,
          name,
          display_name as displayName,
          institution_name as institutionName,
          account_type as accountType,
          account_subtype as accountSubtype,
          reporting_group as reportingGroup,
          balance_minor as balanceMinor,
          currency,
          include_in_household_reporting as includeInHouseholdReporting,
          is_hidden as isHidden,
          ownership_type as ownershipType,
          updated_at as updatedAt
        from accounts
        order by
          case reporting_group
            when 'cash' then 1
            when 'investments' then 2
            when 'liabilities' then 3
            else 4
          end,
          institution_name asc,
          coalesce(display_name, name) asc
      `,
    )
    .all<AccountRow>();

  return rows.results;
}

export async function getAccount(database: LocalD1Database, accountId: string) {
  return database
    .prepare(
      `
        select
          a.id,
          a.name,
          a.display_name as displayName,
          a.institution_name as institutionName,
          a.account_type as accountType,
          a.account_subtype as accountSubtype,
          a.reporting_group as reportingGroup,
          a.balance_minor as balanceMinor,
          a.currency,
          a.include_in_household_reporting as includeInHouseholdReporting,
          a.is_hidden as isHidden,
          a.ownership_type as ownershipType,
          a.created_at as createdAt,
          a.updated_at as updatedAt,
          a.provider_account_id as providerAccountId,
          pa.provider_account_id as providerNativeAccountId,
          pc.id as providerConnectionId,
          pc.provider as provider
        from accounts a
        left join provider_accounts pa on pa.id = a.provider_account_id
        left join provider_connections pc on pc.id = pa.provider_connection_id
        where a.id = ?
      `,
    )
    .bind(accountId)
    .first<AccountDetailRow>();
}

async function requireAccount(database: LocalD1Database, accountId: string) {
  const account = await getAccount(database, accountId);

  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  return account;
}

async function updateAccount(
  database: LocalD1Database,
  accountId: string,
  updates: {
    displayName?: null | string;
    includeInHouseholdReporting?: boolean;
    isHidden?: boolean;
    ownershipType?: OwnershipType;
  },
) {
  await requireAccount(database, accountId);

  const fields: string[] = [];
  const values: unknown[] = [];

  if ("displayName" in updates) {
    fields.push("display_name = ?");
    values.push(updates.displayName?.trim() || null);
  }

  if ("includeInHouseholdReporting" in updates) {
    fields.push("include_in_household_reporting = ?");
    values.push(updates.includeInHouseholdReporting ? 1 : 0);
  }

  if ("isHidden" in updates) {
    fields.push("is_hidden = ?");
    values.push(updates.isHidden ? 1 : 0);
  }

  if ("ownershipType" in updates) {
    fields.push("ownership_type = ?");
    values.push(updates.ownershipType);
  }

  if (fields.length === 0) {
    throw new Error("No account updates were requested.");
  }

  fields.push("updated_at = ?");
  values.push(Date.now(), accountId);

  await database
    .prepare(
      `
        update accounts
        set ${fields.join(", ")}
        where id = ?
      `,
    )
    .bind(...values)
    .run();

  return requireAccount(database, accountId);
}

export async function renameAccount(
  database: LocalD1Database,
  accountId: string,
  displayName: null | string,
) {
  return updateAccount(database, accountId, { displayName });
}

export async function setAccountHidden(
  database: LocalD1Database,
  accountId: string,
  isHidden: boolean,
) {
  return updateAccount(database, accountId, { isHidden });
}

export async function setAccountIncluded(
  database: LocalD1Database,
  accountId: string,
  includeInHouseholdReporting: boolean,
) {
  return updateAccount(database, accountId, { includeInHouseholdReporting });
}

export async function setAccountOwner(
  database: LocalD1Database,
  accountId: string,
  ownershipType: OwnershipType,
) {
  return updateAccount(database, accountId, { ownershipType });
}

export function printAccounts(accounts: AccountRow[]) {
  if (accounts.length === 0) {
    console.log("No accounts found. Run `bun run cli -- sync` first.");
    return;
  }

  const totals = accounts.reduce(
    (summary, account) => {
      if (account.includeInHouseholdReporting === 0 || account.isHidden === 1) {
        return summary;
      }

      summary[account.reportingGroup] += account.balanceMinor;
      return summary;
    },
    {
      cash: 0,
      investments: 0,
      liabilities: 0,
    } satisfies Record<AccountRow["reportingGroup"], number>,
  );
  const netWorth = totals.cash + totals.investments + totals.liabilities;

  console.log(`Net worth: ${formatUsd(netWorth)}`);
  console.log(
    `Cash: ${formatUsd(totals.cash)}  Investments: ${formatUsd(
      totals.investments,
    )}  Liabilities: ${formatUsd(totals.liabilities)}`,
  );
  console.log("");
  console.log(
    [
      pad("Group", 13),
      pad("Institution", 24),
      pad("Account", 34),
      pad("Type", 14),
      pad("Balance", 15),
      "Updated",
    ].join(""),
  );
  console.log("-".repeat(118));

  for (const account of accounts) {
    const flags = [
      account.includeInHouseholdReporting === 0 ? "excluded" : null,
      account.isHidden === 1 ? "hidden" : null,
    ].filter(Boolean);
    const displayName = account.displayName ?? account.name;
    const accountName =
      flags.length > 0 ? `${displayName} (${flags.join(", ")})` : displayName;

    console.log(
      [
        pad(REPORTING_GROUP_LABELS[account.reportingGroup], 13),
        pad(account.institutionName.slice(0, 23), 24),
        pad(accountName.slice(0, 33), 34),
        pad(account.accountType, 14),
        pad(formatUsd(account.balanceMinor), 15),
        formatUpdatedAt(account.updatedAt),
      ].join(""),
    );
  }
}

export function printAccountDetail(account: AccountDetailRow) {
  console.log(`Account: ${account.displayName ?? account.name}`);
  console.log(`ID: ${account.id}`);
  console.log(`Name: ${account.name}`);
  console.log(`Display name: ${account.displayName ?? "(not set)"}`);
  console.log(`Institution: ${account.institutionName}`);
  console.log(`Type: ${account.accountType}`);
  console.log(`Subtype: ${account.accountSubtype ?? "(none)"}`);
  console.log(`Reporting group: ${account.reportingGroup}`);
  console.log(`Balance: ${formatUsd(account.balanceMinor)}`);
  console.log(`Currency: ${account.currency}`);
  console.log(
    `Included in household reporting: ${formatBooleanFlag(
      account.includeInHouseholdReporting,
    )}`,
  );
  console.log(`Hidden: ${formatBooleanFlag(account.isHidden)}`);
  console.log(`Ownership: ${account.ownershipType}`);
  console.log(`Provider: ${account.provider ?? "(manual)"}`);
  console.log(
    `Provider connection: ${account.providerConnectionId ?? "(none)"}`,
  );
  console.log(`Provider account: ${account.providerAccountId ?? "(none)"}`);
  console.log(
    `Provider native account: ${account.providerNativeAccountId ?? "(none)"}`,
  );
  console.log(`Created: ${formatUpdatedAt(account.createdAt)}`);
  console.log(`Updated: ${formatUpdatedAt(account.updatedAt)}`);
}

function printUpdatedAccount(account: AccountDetailRow, action: string) {
  console.log(`${action}: ${account.displayName ?? account.name}`);
  console.log(`Account: ${account.id}`);
}

export async function runAccountsCommand(
  database: LocalD1Database,
  command: AccountCommand,
) {
  if (command.kind === "help") {
    printAccountsHelp();
    return;
  }

  if (command.kind === "list") {
    const accounts = await listAccounts(database);

    if (command.json) {
      printAccountsJson(accounts);
      return;
    }

    printAccounts(accounts);
    return;
  }

  if (command.kind === "show") {
    printAccountDetail(await requireAccount(database, command.accountId));
    return;
  }

  if (command.kind === "rename") {
    const account = await renameAccount(
      database,
      command.accountId,
      command.displayName,
    );
    printUpdatedAccount(account, "Renamed account");
    return;
  }

  if (command.kind === "visibility") {
    const account = await setAccountHidden(
      database,
      command.accountId,
      command.hidden,
    );
    printUpdatedAccount(
      account,
      command.hidden ? "Hid account" : "Unhid account",
    );
    return;
  }

  if (command.kind === "inclusion") {
    const account = await setAccountIncluded(
      database,
      command.accountId,
      command.included,
    );
    printUpdatedAccount(
      account,
      command.included ? "Included account" : "Excluded account",
    );
    return;
  }

  const account = await setAccountOwner(
    database,
    command.accountId,
    command.ownershipType,
  );
  printUpdatedAccount(account, "Updated account owner");
}

export function toAccountsJson(accounts: AccountRow[]) {
  const totals = accounts.reduce(
    (summary, account) => {
      if (account.includeInHouseholdReporting === 0 || account.isHidden === 1) {
        return summary;
      }

      summary[account.reportingGroup] += account.balanceMinor;
      return summary;
    },
    {
      cash: 0,
      investments: 0,
      liabilities: 0,
    } satisfies Record<AccountRow["reportingGroup"], number>,
  );
  const netWorthMinor = totals.cash + totals.investments + totals.liabilities;

  return {
    accounts: accounts.map((account) => ({
      accountSubtype: account.accountSubtype,
      accountType: account.accountType,
      balanceMinor: account.balanceMinor,
      currency: account.currency,
      displayName: account.displayName,
      id: account.id,
      includeInHouseholdReporting: account.includeInHouseholdReporting === 1,
      institutionName: account.institutionName,
      isHidden: account.isHidden === 1,
      name: account.name,
      ownershipType: account.ownershipType,
      reportingGroup: account.reportingGroup,
      updatedAt: formatIsoTimestamp(account.updatedAt),
    })),
    schemaVersion: 1,
    totals: {
      cashMinor: totals.cash,
      currency: "USD",
      investmentsMinor: totals.investments,
      liabilitiesMinor: totals.liabilities,
      netWorthMinor,
    },
  };
}

export function printAccountsJson(accounts: AccountRow[]) {
  printJson(toAccountsJson(accounts));
}
