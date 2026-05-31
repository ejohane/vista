import { createHash } from "node:crypto";
import { printJson } from "./json-output";
import type { LocalD1Database } from "./local-d1";

type TransactionKind = "bank" | "investment";

export type TransactionListOptions = {
  account?: string;
  accountId?: string;
  json: boolean;
  kind?: TransactionKind;
  limit: number;
  mode: "list";
  since?: string;
  until?: string;
};

export type TransactionOptions =
  | TransactionListOptions
  | {
      id: string;
      mode: "exclude" | "include" | "show";
    };

export type TransactionRow = {
  accountId: string;
  accountName: string;
  amountMinor: number;
  currency: string;
  description: string;
  excludedFromReporting: null | number;
  id: string;
  institutionName: string;
  kind: TransactionKind;
  postedDate: string;
  providerTransactionId: string;
  quantity: null | string;
  subtype: null | string;
  symbol: null | string;
  type: string;
};

type TransactionReference = {
  id: string;
  kind: TransactionKind;
  providerTransactionId: string;
};

type BankTransactionDetail = {
  accountId: string;
  accountName: string;
  amountMinor: number;
  categoryNormalized: null | string;
  categoryRaw: null | string;
  currency: string;
  description: string;
  direction: string;
  excludedFromReporting: number;
  id: string;
  institutionName: string;
  merchantName: null | string;
  postedDate: string;
  providerTransactionId: string;
  sourceSyncRunId: string;
};

type InvestmentTransactionDetail = {
  accountId: string;
  accountName: string;
  amountMinor: number;
  currency: string;
  feesMinor: null | number;
  id: string;
  institutionName: string;
  name: string;
  postedDate: string;
  priceMinor: null | number;
  providerTransactionId: string;
  quantity: string;
  securityId: null | string;
  securityName: null | string;
  sourceSyncRunId: string;
  subtype: null | string;
  symbol: null | string;
  tradeDate: null | string;
  type: string;
};

export type TransactionDetail =
  | ({ kind: "bank" } & BankTransactionDetail)
  | ({ kind: "investment" } & InvestmentTransactionDetail);

const DEFAULT_TRANSACTION_LIMIT = 25;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function formatUsd(minor: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(minor / 100);
}

function formatOptionalUsd(minor: null | number) {
  return minor === null ? "-" : formatUsd(minor);
}

function pad(value: string, length: number) {
  return value.padEnd(length, " ");
}

function printField(label: string, value: null | number | string) {
  console.log(`${pad(`${label}:`, 24)}${value ?? "-"}`);
}

function parsePositiveInteger(name: string, value: string | undefined) {
  const numberValue = Number(value);

  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return numberValue;
}

function parseDateOption(name: string, value: string | undefined) {
  if (!value || !DATE_PATTERN.test(value)) {
    throw new Error(`${name} must use YYYY-MM-DD.`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${name} must be a valid YYYY-MM-DD date.`);
  }

  return value;
}

function dateToStartOfDayMs(value: string) {
  return new Date(`${value}T00:00:00.000Z`).getTime();
}

function dateToExclusiveEndMs(value: string) {
  return dateToStartOfDayMs(value) + 24 * 60 * 60 * 1000;
}

function nextArg(argv: string[], index: number, name: string) {
  const value = argv[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function parseKind(value: string | undefined) {
  if (value !== "bank" && value !== "investment") {
    throw new Error("--kind must be bank or investment.");
  }

  return value;
}

function parseListArgs(argv: string[]): TransactionListOptions {
  const options: TransactionListOptions = {
    json: false,
    limit: DEFAULT_TRANSACTION_LIMIT,
    mode: "list",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--limit") {
      options.limit = parsePositiveInteger(
        "--limit",
        nextArg(argv, index, "--limit"),
      );
      index += 1;
      continue;
    }

    if (arg === "--account") {
      options.account = nextArg(argv, index, "--account");
      index += 1;
      continue;
    }

    if (arg === "--since") {
      options.since = parseDateOption(
        "--since",
        nextArg(argv, index, "--since"),
      );
      index += 1;
      continue;
    }

    if (arg === "--until") {
      options.until = parseDateOption(
        "--until",
        nextArg(argv, index, "--until"),
      );
      index += 1;
      continue;
    }

    if (arg === "--kind") {
      options.kind = parseKind(nextArg(argv, index, "--kind"));
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    throw new Error(`Unknown transactions option: ${arg}`);
  }

  if (
    options.since &&
    options.until &&
    dateToStartOfDayMs(options.since) > dateToStartOfDayMs(options.until)
  ) {
    throw new Error("--since must be on or before --until.");
  }

  return options;
}

export function parseTransactionArgs(argv: string[]): TransactionOptions {
  const [command, ...rest] = argv;

  if (!command || command.startsWith("--")) {
    return parseListArgs(argv);
  }

  if (command === "list") {
    return parseListArgs(rest);
  }

  if (command === "show" || command === "exclude" || command === "include") {
    const [id, unexpected] = rest;

    if (!id) {
      throw new Error(`transactions ${command} requires a transaction id.`);
    }

    if (unexpected) {
      throw new Error(
        `Unknown transactions ${command} argument: ${unexpected}`,
      );
    }

    return {
      id,
      mode: command,
    };
  }

  throw new Error(`Unknown transactions command: ${command}`);
}

export function printTransactionsHelp() {
  console.log(`Vista transaction commands

Usage:
  vista transactions [--limit 25] [--account <id-or-name>] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--kind bank|investment] [--json]
  vista transactions show <id>
  vista transactions exclude <id>
  vista transactions include <id>

Notes:
  List output includes stable transaction ids for show/exclude/include.
  Reporting overrides are supported for bank transactions only.
`);
}

export function transactionShortId(kind: TransactionKind, id: string) {
  const prefix = kind === "bank" ? "bank" : "inv";
  const digest = createHash("sha256").update(id).digest("hex").slice(0, 8);

  return `${prefix}-${digest}`;
}

async function resolveAccountId(
  database: LocalD1Database,
  account: string | undefined,
) {
  if (!account) {
    return undefined;
  }

  const exactId = await database
    .prepare(
      `
        select id
        from accounts
        where id = ?
      `,
    )
    .bind(account)
    .first<{ id: string }>();

  if (exactId) {
    return exactId.id;
  }

  const rows = await database
    .prepare(
      `
        select
          id,
          coalesce(display_name, name) as displayName,
          institution_name as institutionName
        from accounts
        where lower(name) = lower(?)
           or lower(display_name) = lower(?)
        order by institution_name asc, displayName asc, id asc
      `,
    )
    .bind(account, account)
    .all<{
      displayName: string;
      id: string;
      institutionName: string;
    }>();

  if (rows.results.length === 0) {
    throw new Error(`No account found for --account ${account}.`);
  }

  if (rows.results.length > 1) {
    throw new Error(
      `--account ${account} is ambiguous. Use one of: ${rows.results
        .map((row) => `${row.id} (${row.institutionName} ${row.displayName})`)
        .join(", ")}`,
    );
  }

  return rows.results[0].id;
}

export async function resolveTransactionListOptions(
  database: LocalD1Database,
  options: TransactionListOptions,
) {
  return {
    ...options,
    accountId: await resolveAccountId(database, options.account),
  };
}

export async function listTransactions(
  database: LocalD1Database,
  options: TransactionListOptions,
) {
  const sinceMs = options.since ? dateToStartOfDayMs(options.since) : null;
  const untilMs = options.until ? dateToExclusiveEndMs(options.until) : null;
  const rows = await database
    .prepare(
      `
        select *
        from (
          select
            'bank' as kind,
            t.id as id,
            t.provider_transaction_id as providerTransactionId,
            t.account_id as accountId,
            date(t.posted_at / 1000, 'unixepoch') as postedDate,
            coalesce(a.display_name, a.name) as accountName,
            a.institution_name as institutionName,
            t.description as description,
            t.direction as type,
            t.category_normalized as subtype,
            t.amount_minor as amountMinor,
            a.currency as currency,
            t.exclude_from_reporting as excludedFromReporting,
            null as quantity,
            null as symbol,
            t.posted_at as postedAt
          from transactions t
          join accounts a on a.id = t.account_id

          union all

          select
            'investment' as kind,
            it.id as id,
            it.provider_transaction_id as providerTransactionId,
            it.account_id as accountId,
            date(it.posted_at / 1000, 'unixepoch') as postedDate,
            coalesce(a.display_name, a.name) as accountName,
            a.institution_name as institutionName,
            it.name as description,
            it.type as type,
            it.subtype as subtype,
            it.amount_minor as amountMinor,
            it.currency as currency,
            null as excludedFromReporting,
            it.quantity as quantity,
            s.symbol as symbol,
            it.posted_at as postedAt
          from investment_transactions it
          join accounts a on a.id = it.account_id
          left join securities s on s.id = it.security_id
        )
        where (? is null or kind = ?)
          and (? is null or accountId = ?)
          and (? is null or postedAt >= ?)
          and (? is null or postedAt < ?)
        order by postedAt desc
        limit ?
      `,
    )
    .bind(
      options.kind ?? null,
      options.kind ?? null,
      options.accountId ?? null,
      options.accountId ?? null,
      sinceMs,
      sinceMs,
      untilMs,
      untilMs,
      options.limit,
    )
    .all<TransactionRow>();

  return rows.results;
}

async function listTransactionReferences(database: LocalD1Database) {
  const rows = await database
    .prepare(
      `
        select
          'bank' as kind,
          id,
          provider_transaction_id as providerTransactionId
        from transactions

        union all

        select
          'investment' as kind,
          id,
          provider_transaction_id as providerTransactionId
        from investment_transactions
      `,
    )
    .all<TransactionReference>();

  return rows.results;
}

export async function resolveTransactionReference(
  database: LocalD1Database,
  reference: string,
) {
  const exactRows = await database
    .prepare(
      `
        select
          'bank' as kind,
          id,
          provider_transaction_id as providerTransactionId
        from transactions
        where id = ? or provider_transaction_id = ?

        union all

        select
          'investment' as kind,
          id,
          provider_transaction_id as providerTransactionId
        from investment_transactions
        where id = ? or provider_transaction_id = ?
      `,
    )
    .bind(reference, reference, reference, reference)
    .all<TransactionReference>();

  if (exactRows.results.length === 1) {
    return exactRows.results[0];
  }

  if (exactRows.results.length > 1) {
    throw new Error(`Transaction id ${reference} is ambiguous.`);
  }

  const allRows = await listTransactionReferences(database);
  const supportsPrefix = reference.length >= 6;
  const matches = allRows.filter((row) => {
    if (transactionShortId(row.kind, row.id) === reference) {
      return true;
    }

    return (
      supportsPrefix &&
      (row.id.startsWith(reference) ||
        row.providerTransactionId.startsWith(reference))
    );
  });

  if (matches.length === 0) {
    throw new Error(`No transaction found for id ${reference}.`);
  }

  if (matches.length > 1) {
    throw new Error(
      `Transaction id ${reference} is ambiguous. Use one of: ${matches
        .map((row) => transactionShortId(row.kind, row.id))
        .join(", ")}`,
    );
  }

  return matches[0];
}

export async function showTransaction(
  database: LocalD1Database,
  reference: string,
) {
  const resolved = await resolveTransactionReference(database, reference);

  if (resolved.kind === "bank") {
    const row = await database
      .prepare(
        `
          select
            'bank' as kind,
            t.id as id,
            t.provider_transaction_id as providerTransactionId,
            t.account_id as accountId,
            coalesce(a.display_name, a.name) as accountName,
            a.institution_name as institutionName,
            a.currency as currency,
            t.source_sync_run_id as sourceSyncRunId,
            date(t.posted_at / 1000, 'unixepoch') as postedDate,
            t.description as description,
            t.merchant_name as merchantName,
            t.amount_minor as amountMinor,
            t.direction as direction,
            t.category_raw as categoryRaw,
            t.category_normalized as categoryNormalized,
            t.exclude_from_reporting as excludedFromReporting
          from transactions t
          join accounts a on a.id = t.account_id
          where t.id = ?
        `,
      )
      .bind(resolved.id)
      .first<TransactionDetail>();

    if (!row) {
      throw new Error(`No transaction found for id ${reference}.`);
    }

    return row;
  }

  const row = await database
    .prepare(
      `
        select
          'investment' as kind,
          it.id as id,
          it.provider_transaction_id as providerTransactionId,
          it.account_id as accountId,
          coalesce(a.display_name, a.name) as accountName,
          a.institution_name as institutionName,
          it.currency as currency,
          it.source_sync_run_id as sourceSyncRunId,
          date(it.posted_at / 1000, 'unixepoch') as postedDate,
          case
            when it.trade_at is null then null
            else date(it.trade_at / 1000, 'unixepoch')
          end as tradeDate,
          it.name as name,
          it.type as type,
          it.subtype as subtype,
          it.amount_minor as amountMinor,
          it.fees_minor as feesMinor,
          it.price_minor as priceMinor,
          it.quantity as quantity,
          it.security_id as securityId,
          s.symbol as symbol,
          s.name as securityName
        from investment_transactions it
        join accounts a on a.id = it.account_id
        left join securities s on s.id = it.security_id
        where it.id = ?
      `,
    )
    .bind(resolved.id)
    .first<TransactionDetail>();

  if (!row) {
    throw new Error(`No transaction found for id ${reference}.`);
  }

  return row;
}

export async function setBankTransactionReportingOverride(
  database: LocalD1Database,
  reference: string,
  excludedFromReporting: boolean,
) {
  const resolved = await resolveTransactionReference(database, reference);

  if (resolved.kind !== "bank") {
    throw new Error(
      "Investment transactions do not support reporting overrides. Only bank transactions can be excluded or included.",
    );
  }

  await database
    .prepare(
      `
        update transactions
        set exclude_from_reporting = ?
        where id = ?
      `,
    )
    .bind(excludedFromReporting ? 1 : 0, resolved.id)
    .run();

  return showTransaction(database, resolved.id);
}

export function printTransactions(
  transactions: TransactionRow[],
  options: TransactionListOptions,
) {
  if (transactions.length === 0) {
    console.log("No transactions found. Run `bun run cli -- sync` first.");
    return;
  }

  console.log(`Latest ${transactions.length} transactions`);
  console.log("");
  console.log(
    [
      pad("ID", 14),
      pad("Date", 12),
      pad("Kind", 12),
      pad("Account", 20),
      pad("Type", 14),
      pad("Symbol", 9),
      pad("Amount", 13),
      pad("Rpt", 5),
      "Description",
    ].join(""),
  );
  console.log("-".repeat(138));

  for (const transaction of transactions.slice(0, options.limit)) {
    const type = transaction.subtype
      ? `${transaction.type}/${transaction.subtype}`
      : transaction.type;
    const reporting =
      transaction.excludedFromReporting === null
        ? "-"
        : transaction.excludedFromReporting === 1
          ? "off"
          : "on";

    console.log(
      [
        pad(transactionShortId(transaction.kind, transaction.id), 14),
        pad(transaction.postedDate, 12),
        pad(transaction.kind, 12),
        pad(transaction.accountName.slice(0, 19), 20),
        pad(type.slice(0, 13), 14),
        pad((transaction.symbol || "-").slice(0, 8), 9),
        pad(formatUsd(transaction.amountMinor), 13),
        pad(reporting, 5),
        transaction.description.slice(0, 52),
      ].join(""),
    );
  }
}

export function printTransactionDetail(transaction: TransactionDetail) {
  console.log(
    `${
      transaction.kind === "bank" ? "Bank" : "Investment"
    } transaction ${transactionShortId(transaction.kind, transaction.id)}`,
  );
  console.log("");
  printField("ID", transactionShortId(transaction.kind, transaction.id));
  printField("Full local ID", transaction.id);
  printField("Provider ID", transaction.providerTransactionId);
  printField("Account", transaction.accountName);
  printField("Account ID", transaction.accountId);
  printField("Institution", transaction.institutionName);
  printField("Posted date", transaction.postedDate);
  printField("Amount", formatUsd(transaction.amountMinor));
  printField("Currency", transaction.currency);
  printField("Source sync run", transaction.sourceSyncRunId);

  if (transaction.kind === "bank") {
    printField("Description", transaction.description);
    printField("Merchant", transaction.merchantName);
    printField("Direction", transaction.direction);
    printField("Category raw", transaction.categoryRaw);
    printField("Category", transaction.categoryNormalized);
    printField(
      "Reporting",
      transaction.excludedFromReporting === 1 ? "excluded" : "included",
    );
    return;
  }

  printField("Name", transaction.name);
  printField("Type", transaction.type);
  printField("Subtype", transaction.subtype);
  printField("Trade date", transaction.tradeDate);
  printField("Symbol", transaction.symbol);
  printField("Security", transaction.securityName);
  printField("Security ID", transaction.securityId);
  printField("Quantity", transaction.quantity);
  printField("Price", formatOptionalUsd(transaction.priceMinor));
  printField("Fees", formatOptionalUsd(transaction.feesMinor));
}

export function toTransactionsJson(
  transactions: TransactionRow[],
  options: TransactionListOptions,
) {
  return {
    count: transactions.length,
    filters: {
      account: options.account ?? null,
      kind: options.kind ?? null,
      since: options.since ?? null,
      until: options.until ?? null,
    },
    limit: options.limit,
    schemaVersion: 1,
    transactions: transactions.map((transaction) => ({
      accountId: transaction.accountId,
      accountName: transaction.accountName,
      amountMinor: transaction.amountMinor,
      currency: transaction.currency,
      description: transaction.description,
      excludedFromReporting:
        transaction.excludedFromReporting === null
          ? null
          : transaction.excludedFromReporting === 1,
      id: transactionShortId(transaction.kind, transaction.id),
      kind: transaction.kind,
      localId: transaction.id,
      postedDate: transaction.postedDate,
      providerTransactionId: transaction.providerTransactionId,
      quantity: transaction.quantity,
      subtype: transaction.subtype,
      symbol: transaction.symbol,
      type: transaction.type,
    })),
  };
}

export function printTransactionsJson(
  transactions: TransactionRow[],
  options: TransactionListOptions,
) {
  printJson(toTransactionsJson(transactions, options));
}
