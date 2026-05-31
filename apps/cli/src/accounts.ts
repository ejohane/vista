import { formatIsoTimestamp, printJson } from "./json-output";
import type { LocalD1Database } from "./local-d1";

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
  reportingGroup: "cash" | "investments" | "liabilities";
  updatedAt: number;
};

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
