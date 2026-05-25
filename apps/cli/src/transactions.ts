import type { LocalD1Database } from "./local-d1";

type TransactionOptions = {
  limit: number;
};

type TransactionRow = {
  accountName: string;
  amountMinor: number;
  description: string;
  kind: "bank" | "investment";
  postedDate: string;
  quantity: null | string;
  subtype: null | string;
  symbol: null | string;
  type: string;
};

const DEFAULT_TRANSACTION_LIMIT = 25;

function formatUsd(minor: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(minor / 100);
}

function pad(value: string, length: number) {
  return value.padEnd(length, " ");
}

export function parseTransactionArgs(argv: string[]): TransactionOptions {
  const options: TransactionOptions = {
    limit: DEFAULT_TRANSACTION_LIMIT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--limit") {
      index += 1;
      options.limit = Number(argv[index]);
      continue;
    }

    throw new Error(`Unknown transactions option: ${arg}`);
  }

  if (!Number.isInteger(options.limit) || options.limit <= 0) {
    throw new Error("--limit must be a positive integer.");
  }

  return options;
}

export async function listTransactions(
  database: LocalD1Database,
  options: TransactionOptions,
) {
  const rows = await database
    .prepare(
      `
        select *
        from (
          select
            'bank' as kind,
            date(t.posted_at / 1000, 'unixepoch') as postedDate,
            coalesce(a.display_name, a.name) as accountName,
            t.description as description,
            t.direction as type,
            t.category_normalized as subtype,
            t.amount_minor as amountMinor,
            null as quantity,
            null as symbol,
            t.posted_at as postedAt
          from transactions t
          join accounts a on a.id = t.account_id

          union all

          select
            'investment' as kind,
            date(it.posted_at / 1000, 'unixepoch') as postedDate,
            coalesce(a.display_name, a.name) as accountName,
            it.name as description,
            it.type as type,
            it.subtype as subtype,
            it.amount_minor as amountMinor,
            it.quantity as quantity,
            s.symbol as symbol,
            it.posted_at as postedAt
          from investment_transactions it
          join accounts a on a.id = it.account_id
          left join securities s on s.id = it.security_id
        )
        order by postedAt desc
        limit ?
      `,
    )
    .bind(options.limit)
    .all<TransactionRow>();

  return rows.results;
}

export function printTransactions(
  transactions: TransactionRow[],
  options: TransactionOptions,
) {
  if (transactions.length === 0) {
    console.log("No transactions found. Run `bun run cli -- sync` first.");
    return;
  }

  console.log(`Latest ${transactions.length} transactions`);
  console.log("");
  console.log(
    [
      pad("Date", 12),
      pad("Kind", 12),
      pad("Account", 20),
      pad("Type", 14),
      pad("Symbol", 9),
      pad("Amount", 13),
      "Description",
    ].join(""),
  );
  console.log("-".repeat(118));

  for (const transaction of transactions.slice(0, options.limit)) {
    const type = transaction.subtype
      ? `${transaction.type}/${transaction.subtype}`
      : transaction.type;

    console.log(
      [
        pad(transaction.postedDate, 12),
        pad(transaction.kind, 12),
        pad(transaction.accountName.slice(0, 19), 20),
        pad(type.slice(0, 13), 14),
        pad((transaction.symbol || "-").slice(0, 8), 9),
        pad(formatUsd(transaction.amountMinor), 13),
        transaction.description.slice(0, 52),
      ].join(""),
    );
  }
}
