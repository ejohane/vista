import type { LocalD1Database } from "./local-d1";

const PROVIDER_CONNECTIONS_SCHEMA_SQL = `
create table provider_connections (
  id text primary key,
  household_id text not null references households(id),
  provider text not null check (provider in ('plaid', 'coinbase')),
  status text not null check (status in ('active', 'disconnected', 'error')),
  external_connection_id text not null,
  access_token text,
  access_token_encrypted text,
  access_secret text,
  access_secret_encrypted text,
  access_url text,
  credential_key_version integer default 1,
  plaid_item_id text,
  institution_id text,
  institution_name text,
  created_at integer not null,
  updated_at integer not null
)`;

const SYNC_RUNS_SCHEMA_SQL = `
create table sync_runs (
  id text primary key,
  household_id text not null references households(id),
  provider_connection_id text references provider_connections(id),
  provider text check (provider is null or provider in ('plaid', 'coinbase')),
  status text not null check (status in ('running', 'succeeded', 'failed')),
  trigger text not null check (trigger in ('seed', 'scheduled')),
  started_at integer not null,
  completed_at integer,
  records_changed integer not null default 0,
  error_summary text
)`;

const SECURITIES_SCHEMA_SQL = `
create table securities (
  id text primary key,
  provider text not null check (provider in ('plaid', 'coinbase')),
  provider_security_id text not null,
  symbol text,
  name text not null,
  security_type text,
  security_subtype text,
  currency text not null default 'USD',
  price_source text not null check (price_source in ('alpha_vantage', 'plaid_holdings', 'coinbase', 'missing')),
  created_at integer not null,
  updated_at integer not null
)`;

const SECURITY_PRICE_DAILY_SCHEMA_SQL = `
create table security_price_daily (
  security_id text not null references securities(id),
  price_date text not null,
  close_price_minor integer,
  currency text not null default 'USD',
  source text not null check (source in ('alpha_vantage', 'plaid_holdings', 'coinbase', 'missing')),
  is_estimated integer not null default 0 check (is_estimated in (0, 1)),
  fetched_at integer not null
)`;

const CURRENT_SCHEMA_SQL = `
create table if not exists households (
  id text primary key,
  name text not null,
  last_synced_at integer not null,
  created_at integer not null
);

create table if not exists members (
  id text primary key,
  household_id text not null references households(id),
  role text not null check (role in ('owner', 'member')),
  display_name text,
  email text,
  created_at integer not null,
  updated_at integer not null
);
create index if not exists members_household_idx on members(household_id);

create table if not exists user_identities (
  id text primary key,
  member_id text not null references members(id),
  provider text not null check (provider in ('clerk')),
  provider_user_id text not null,
  email text,
  last_seen_at integer not null,
  created_at integer not null,
  updated_at integer not null
);
create index if not exists user_identities_member_idx on user_identities(member_id);
create unique index if not exists user_identities_provider_user_idx on user_identities(provider, provider_user_id);

create table if not exists provider_connections (
  id text primary key,
  household_id text not null references households(id),
  provider text not null check (provider in ('plaid', 'coinbase')),
  status text not null check (status in ('active', 'disconnected', 'error')),
  external_connection_id text not null,
  access_token text,
  access_token_encrypted text,
  access_secret text,
  access_secret_encrypted text,
  access_url text,
  credential_key_version integer default 1,
  plaid_item_id text,
  institution_id text,
  institution_name text,
  created_at integer not null,
  updated_at integer not null
);
create index if not exists provider_connections_household_idx on provider_connections(household_id);
create unique index if not exists provider_connections_provider_external_idx on provider_connections(provider, external_connection_id);

create table if not exists provider_accounts (
  id text primary key,
  provider_connection_id text not null references provider_connections(id),
  provider_account_id text not null,
  name text not null,
  institution_name text not null,
  account_type text not null check (account_type in ('checking', 'savings', 'credit_card', 'brokerage', 'retirement', 'mortgage', 'student_loan', 'loan', 'line_of_credit')),
  account_subtype text,
  currency text not null default 'USD',
  created_at integer not null,
  updated_at integer not null
);
create index if not exists provider_accounts_connection_idx on provider_accounts(provider_connection_id);
create unique index if not exists provider_accounts_connection_native_idx on provider_accounts(provider_connection_id, provider_account_id);

create table if not exists accounts (
  id text primary key,
  household_id text not null references households(id),
  provider_account_id text references provider_accounts(id),
  name text not null,
  display_name text,
  institution_name text not null,
  account_type text not null check (account_type in ('checking', 'savings', 'credit_card', 'brokerage', 'retirement', 'mortgage', 'student_loan', 'loan', 'line_of_credit')),
  account_subtype text,
  reporting_group text not null check (reporting_group in ('cash', 'liabilities', 'investments')),
  ownership_type text not null default 'joint' check (ownership_type in ('mine', 'wife', 'joint')),
  include_in_household_reporting integer not null default 1 check (include_in_household_reporting in (0, 1)),
  is_hidden integer not null default 0 check (is_hidden in (0, 1)),
  balance_minor integer not null,
  currency text not null default 'USD',
  created_at integer not null,
  updated_at integer not null,
  check (
    (account_type in ('checking', 'savings') and reporting_group = 'cash')
    or
    (account_type in ('credit_card', 'mortgage', 'student_loan', 'loan', 'line_of_credit') and reporting_group = 'liabilities')
    or
    (account_type in ('brokerage', 'retirement') and reporting_group = 'investments')
  )
);
create unique index if not exists accounts_provider_account_idx on accounts(provider_account_id);

create table if not exists sync_runs (
  id text primary key,
  household_id text not null references households(id),
  provider_connection_id text references provider_connections(id),
  provider text check (provider is null or provider in ('plaid', 'coinbase')),
  status text not null check (status in ('running', 'succeeded', 'failed')),
  trigger text not null check (trigger in ('seed', 'scheduled')),
  started_at integer not null,
  completed_at integer,
  records_changed integer not null default 0,
  error_summary text
);
create index if not exists sync_runs_household_idx on sync_runs(household_id);
create index if not exists sync_runs_household_completed_idx on sync_runs(household_id, completed_at);
create index if not exists sync_runs_connection_idx on sync_runs(provider_connection_id);

create table if not exists sync_checkpoints (
  provider_connection_id text primary key references provider_connections(id),
  cursor text not null,
  updated_at integer not null
);
create index if not exists sync_checkpoints_updated_idx on sync_checkpoints(updated_at);

create table if not exists balance_snapshots (
  id text primary key,
  account_id text not null references accounts(id),
  source_sync_run_id text not null references sync_runs(id),
  captured_at integer not null,
  as_of_date text not null,
  balance_minor integer not null
);
create index if not exists balance_snapshots_run_idx on balance_snapshots(source_sync_run_id);
create index if not exists balance_snapshots_account_idx on balance_snapshots(account_id);
create unique index if not exists balance_snapshots_account_run_idx on balance_snapshots(account_id, source_sync_run_id);

create table if not exists transactions (
  id text primary key,
  account_id text not null references accounts(id),
  source_sync_run_id text not null references sync_runs(id),
  provider_transaction_id text not null,
  posted_at integer not null,
  description text not null,
  merchant_name text,
  amount_minor integer not null,
  direction text not null check (direction in ('credit', 'debit')),
  category_raw text,
  category_normalized text,
  exclude_from_reporting integer not null default 0 check (exclude_from_reporting in (0, 1))
);
create index if not exists transactions_account_posted_idx on transactions(account_id, posted_at);
create index if not exists transactions_run_idx on transactions(source_sync_run_id);
create unique index if not exists transactions_account_provider_idx on transactions(account_id, provider_transaction_id);

create table if not exists income_profiles (
  id text primary key,
  household_id text not null references households(id),
  person_name text not null,
  source text not null,
  salary_minor integer not null check (salary_minor >= 0),
  bonus_minor integer not null default 0 check (bonus_minor >= 0),
  currency text not null default 'USD',
  effective_date text not null,
  note text,
  created_at integer not null,
  updated_at integer not null,
  check (salary_minor + bonus_minor > 0)
);
create unique index if not exists income_profiles_household_person_source_idx on income_profiles(household_id, person_name, source);
create index if not exists income_profiles_household_person_idx on income_profiles(household_id, person_name);

create table if not exists securities (
  id text primary key,
  provider text not null check (provider in ('plaid', 'coinbase')),
  provider_security_id text not null,
  symbol text,
  name text not null,
  security_type text,
  security_subtype text,
  currency text not null default 'USD',
  price_source text not null check (price_source in ('alpha_vantage', 'plaid_holdings', 'coinbase', 'missing')),
  created_at integer not null,
  updated_at integer not null
);
create unique index if not exists securities_provider_security_idx on securities(provider, provider_security_id);
create index if not exists securities_symbol_idx on securities(symbol);

create table if not exists holdings (
  id text primary key,
  account_id text not null references accounts(id),
  security_id text,
  holding_key text not null,
  symbol text,
  name text not null,
  asset_class text not null check (asset_class in ('cash', 'equity', 'fixed_income', 'crypto', 'fund', 'other')),
  sub_asset_class text,
  currency text not null default 'USD',
  created_at integer not null,
  updated_at integer not null
);
create index if not exists holdings_account_idx on holdings(account_id);
create unique index if not exists holdings_account_key_idx on holdings(account_id, holding_key);

create table if not exists security_price_daily (
  security_id text not null references securities(id),
  price_date text not null,
  close_price_minor integer,
  currency text not null default 'USD',
  source text not null check (source in ('alpha_vantage', 'plaid_holdings', 'coinbase', 'missing')),
  is_estimated integer not null default 0 check (is_estimated in (0, 1)),
  fetched_at integer not null
);
create unique index if not exists security_price_daily_security_date_idx on security_price_daily(security_id, price_date);
create index if not exists security_price_daily_date_idx on security_price_daily(price_date);

create table if not exists investment_transactions (
  id text primary key,
  account_id text not null references accounts(id),
  source_sync_run_id text not null references sync_runs(id),
  provider_transaction_id text not null,
  posted_at integer not null,
  trade_at integer,
  type text not null,
  subtype text,
  name text not null,
  amount_minor integer not null,
  fees_minor integer,
  price_minor integer,
  quantity text not null,
  security_id text,
  currency text not null default 'USD'
);
create index if not exists investment_transactions_account_posted_idx on investment_transactions(account_id, posted_at);
create index if not exists investment_transactions_run_idx on investment_transactions(source_sync_run_id);
create unique index if not exists investment_transactions_account_provider_idx on investment_transactions(account_id, provider_transaction_id);

create table if not exists holding_snapshots (
  id text primary key,
  holding_id text not null references holdings(id),
  account_id text not null references accounts(id),
  source_sync_run_id text not null references sync_runs(id),
  captured_at integer not null,
  as_of_date text not null,
  quantity text not null,
  price_minor integer,
  market_value_minor integer not null,
  cost_basis_minor integer
);
create index if not exists holding_snapshots_account_idx on holding_snapshots(account_id);
create index if not exists holding_snapshots_run_idx on holding_snapshots(source_sync_run_id);
create unique index if not exists holding_snapshots_holding_run_idx on holding_snapshots(holding_id, source_sync_run_id);

create table if not exists daily_security_position_facts (
  household_id text not null references households(id),
  account_id text not null references accounts(id),
  security_id text not null references securities(id),
  position_date text not null,
  quantity text not null,
  cost_basis_minor integer,
  is_estimated integer not null default 0 check (is_estimated in (0, 1)),
  source_window_start text not null,
  source_window_end text not null,
  rebuilt_at integer not null
);
create unique index if not exists daily_security_position_facts_account_security_date_idx on daily_security_position_facts(account_id, security_id, position_date);
create index if not exists daily_security_position_facts_household_date_idx on daily_security_position_facts(household_id, position_date);

create table if not exists daily_investment_account_value_facts (
  household_id text not null references households(id),
  account_id text not null references accounts(id),
  fact_date text not null,
  market_value_minor integer not null default 0,
  cost_basis_minor integer not null default 0,
  priced_position_count integer not null default 0,
  missing_price_count integer not null default 0,
  is_estimated integer not null default 0 check (is_estimated in (0, 1)),
  rebuilt_at integer not null
);
create unique index if not exists daily_investment_account_value_facts_account_date_idx on daily_investment_account_value_facts(account_id, fact_date);
create index if not exists daily_investment_account_value_facts_household_date_idx on daily_investment_account_value_facts(household_id, fact_date);

create table if not exists daily_net_worth_facts (
  household_id text not null references households(id),
  fact_date text not null,
  cash_minor integer not null default 0,
  liabilities_minor integer not null default 0,
  investments_minor integer not null default 0,
  net_worth_minor integer not null default 0,
  coverage_mode text not null check (coverage_mode in ('snapshot_only', 'investments_backfilled', 'mixed_snapshot_and_backfill')),
  is_estimated integer not null default 0 check (is_estimated in (0, 1)),
  rebuilt_at integer not null
);
create unique index if not exists daily_net_worth_facts_household_date_idx on daily_net_worth_facts(household_id, fact_date);
`;

type SchemaRow = {
  sql: string;
};

function tableSql(database: LocalD1Database, tableName: string) {
  const row = database.sqlite
    .query(
      `
        select sql
        from sqlite_master
        where type = 'table' and name = ?
      `,
    )
    .get(tableName) as null | SchemaRow;

  return row?.sql ?? "";
}

function rebuildTable(args: {
  columns: string[];
  database: LocalD1Database;
  schemaSql: string;
  tableName: string;
}) {
  const oldTableName = `__vista_old_${args.tableName}`;
  const quotedColumns = args.columns.join(", ");

  args.database.sqlite.exec("pragma foreign_keys = off");
  args.database.sqlite.exec("pragma legacy_alter_table = on");

  try {
    args.database.sqlite.exec(`drop table if exists ${oldTableName}`);
    args.database.sqlite.exec(
      `alter table ${args.tableName} rename to ${oldTableName}`,
    );
    args.database.sqlite.exec(args.schemaSql);
    args.database.sqlite.exec(
      `insert into ${args.tableName} (${quotedColumns}) select ${quotedColumns} from ${oldTableName}`,
    );
    args.database.sqlite.exec(`drop table ${oldTableName}`);
  } finally {
    args.database.sqlite.exec("pragma legacy_alter_table = off");
    args.database.sqlite.exec("pragma foreign_keys = on");
  }
}

function ensureCoinbaseSchemaSupport(database: LocalD1Database) {
  if (!tableSql(database, "provider_connections").includes("'coinbase'")) {
    rebuildTable({
      columns: [
        "id",
        "household_id",
        "provider",
        "status",
        "external_connection_id",
        "access_token",
        "access_token_encrypted",
        "access_secret",
        "access_secret_encrypted",
        "access_url",
        "credential_key_version",
        "plaid_item_id",
        "institution_id",
        "institution_name",
        "created_at",
        "updated_at",
      ],
      database,
      schemaSql: PROVIDER_CONNECTIONS_SCHEMA_SQL,
      tableName: "provider_connections",
    });
  }

  if (!tableSql(database, "sync_runs").includes("'coinbase'")) {
    rebuildTable({
      columns: [
        "id",
        "household_id",
        "provider_connection_id",
        "provider",
        "status",
        "trigger",
        "started_at",
        "completed_at",
        "records_changed",
        "error_summary",
      ],
      database,
      schemaSql: SYNC_RUNS_SCHEMA_SQL,
      tableName: "sync_runs",
    });
  }

  if (!tableSql(database, "securities").includes("'coinbase'")) {
    rebuildTable({
      columns: [
        "id",
        "provider",
        "provider_security_id",
        "symbol",
        "name",
        "security_type",
        "security_subtype",
        "currency",
        "price_source",
        "created_at",
        "updated_at",
      ],
      database,
      schemaSql: SECURITIES_SCHEMA_SQL,
      tableName: "securities",
    });
  }

  if (!tableSql(database, "security_price_daily").includes("'coinbase'")) {
    rebuildTable({
      columns: [
        "security_id",
        "price_date",
        "close_price_minor",
        "currency",
        "source",
        "is_estimated",
        "fetched_at",
      ],
      database,
      schemaSql: SECURITY_PRICE_DAILY_SCHEMA_SQL,
      tableName: "security_price_daily",
    });
  }
}

export async function ensureLocalSchema(database: LocalD1Database) {
  await database.exec(CURRENT_SCHEMA_SQL);
  ensureCoinbaseSchemaSupport(database);
  await database.exec(CURRENT_SCHEMA_SQL);
}
