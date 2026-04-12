export const HOUSEHOLD_STATE_SCHEMA_SQL = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS households (
    created_at INTEGER NOT NULL,
    id TEXT PRIMARY KEY,
    last_synced_at INTEGER NOT NULL,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS provider_connections (
    access_token TEXT,
    access_secret TEXT,
    access_url TEXT,
    created_at INTEGER NOT NULL,
    external_connection_id TEXT NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id),
    id TEXT PRIMARY KEY,
    institution_id TEXT,
    institution_name TEXT,
    plaid_item_id TEXT,
    provider TEXT NOT NULL CHECK(provider IN ('plaid')),
    status TEXT NOT NULL CHECK(status IN ('active', 'disconnected', 'error')),
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS provider_connections_household_idx
    ON provider_connections(household_id);
  CREATE UNIQUE INDEX IF NOT EXISTS provider_connections_provider_external_idx
    ON provider_connections(provider, external_connection_id);

  CREATE TABLE IF NOT EXISTS provider_accounts (
    account_subtype TEXT,
    account_type TEXT NOT NULL CHECK(account_type IN ('checking', 'savings', 'credit_card', 'brokerage', 'retirement', 'mortgage', 'student_loan', 'loan', 'line_of_credit')),
    created_at INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    id TEXT PRIMARY KEY,
    institution_name TEXT NOT NULL,
    name TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    provider_connection_id TEXT NOT NULL REFERENCES provider_connections(id),
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS provider_accounts_connection_idx
    ON provider_accounts(provider_connection_id);
  CREATE UNIQUE INDEX IF NOT EXISTS provider_accounts_connection_native_idx
    ON provider_accounts(provider_connection_id, provider_account_id);

  CREATE TABLE IF NOT EXISTS accounts (
    account_subtype TEXT,
    account_type TEXT NOT NULL CHECK(account_type IN ('checking', 'savings', 'credit_card', 'brokerage', 'retirement', 'mortgage', 'student_loan', 'loan', 'line_of_credit')),
    balance_minor INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    display_name TEXT,
    household_id TEXT NOT NULL REFERENCES households(id),
    id TEXT PRIMARY KEY,
    include_in_household_reporting INTEGER NOT NULL DEFAULT 1 CHECK(include_in_household_reporting IN (0, 1)),
    institution_name TEXT NOT NULL,
    is_hidden INTEGER NOT NULL DEFAULT 0 CHECK(is_hidden IN (0, 1)),
    name TEXT NOT NULL,
    ownership_type TEXT NOT NULL DEFAULT 'joint' CHECK(ownership_type IN ('mine', 'wife', 'joint')),
    provider_account_id TEXT REFERENCES provider_accounts(id),
    reporting_group TEXT NOT NULL CHECK(reporting_group IN ('cash', 'liabilities', 'investments')),
    updated_at INTEGER NOT NULL,
    CHECK((
      (account_type IN ('checking', 'savings') AND reporting_group = 'cash') OR
      (account_type IN ('credit_card', 'mortgage', 'student_loan', 'loan', 'line_of_credit') AND reporting_group = 'liabilities') OR
      (account_type IN ('brokerage', 'retirement') AND reporting_group = 'investments')
    ))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_account_idx
    ON accounts(provider_account_id);
  CREATE INDEX IF NOT EXISTS accounts_household_idx
    ON accounts(household_id);

  CREATE TABLE IF NOT EXISTS sync_runs (
    completed_at INTEGER,
    error_summary TEXT,
    household_id TEXT NOT NULL REFERENCES households(id),
    id TEXT PRIMARY KEY,
    provider TEXT CHECK(provider IS NULL OR provider IN ('plaid')),
    provider_connection_id TEXT REFERENCES provider_connections(id),
    records_changed INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed')),
    trigger TEXT NOT NULL CHECK(trigger IN ('seed', 'scheduled'))
  );
  CREATE INDEX IF NOT EXISTS sync_runs_household_idx
    ON sync_runs(household_id);
  CREATE INDEX IF NOT EXISTS sync_runs_household_completed_idx
    ON sync_runs(household_id, completed_at);
  CREATE INDEX IF NOT EXISTS sync_runs_connection_idx
    ON sync_runs(provider_connection_id);

  CREATE TABLE IF NOT EXISTS balance_snapshots (
    account_id TEXT NOT NULL REFERENCES accounts(id),
    as_of_date TEXT NOT NULL,
    balance_minor INTEGER NOT NULL,
    captured_at INTEGER NOT NULL,
    id TEXT PRIMARY KEY,
    source_sync_run_id TEXT NOT NULL REFERENCES sync_runs(id)
  );
  CREATE INDEX IF NOT EXISTS balance_snapshots_run_idx
    ON balance_snapshots(source_sync_run_id);
  CREATE INDEX IF NOT EXISTS balance_snapshots_account_idx
    ON balance_snapshots(account_id);
  CREATE UNIQUE INDEX IF NOT EXISTS balance_snapshots_account_run_idx
    ON balance_snapshots(account_id, source_sync_run_id);

  CREATE TABLE IF NOT EXISTS holdings (
    account_id TEXT NOT NULL REFERENCES accounts(id),
    asset_class TEXT NOT NULL CHECK(asset_class IN ('cash', 'equity', 'fixed_income', 'crypto', 'fund', 'other')),
    created_at INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    holding_key TEXT NOT NULL,
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    security_id TEXT,
    sub_asset_class TEXT,
    symbol TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS holdings_account_idx
    ON holdings(account_id);
  CREATE UNIQUE INDEX IF NOT EXISTS holdings_account_key_idx
    ON holdings(account_id, holding_key);

  CREATE TABLE IF NOT EXISTS holding_snapshots (
    account_id TEXT NOT NULL REFERENCES accounts(id),
    as_of_date TEXT NOT NULL,
    captured_at INTEGER NOT NULL,
    cost_basis_minor INTEGER,
    holding_id TEXT NOT NULL REFERENCES holdings(id),
    id TEXT PRIMARY KEY,
    market_value_minor INTEGER NOT NULL,
    price_minor INTEGER,
    quantity TEXT NOT NULL,
    source_sync_run_id TEXT NOT NULL REFERENCES sync_runs(id)
  );
  CREATE INDEX IF NOT EXISTS holding_snapshots_account_idx
    ON holding_snapshots(account_id);
  CREATE INDEX IF NOT EXISTS holding_snapshots_run_idx
    ON holding_snapshots(source_sync_run_id);
  CREATE UNIQUE INDEX IF NOT EXISTS holding_snapshots_holding_run_idx
    ON holding_snapshots(holding_id, source_sync_run_id);

  CREATE TABLE IF NOT EXISTS daily_net_worth_facts (
    cash_minor INTEGER NOT NULL DEFAULT 0,
    coverage_mode TEXT NOT NULL CHECK(coverage_mode IN ('snapshot_only', 'investments_backfilled', 'mixed_snapshot_and_backfill')),
    fact_date TEXT NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id),
    investments_minor INTEGER NOT NULL DEFAULT 0,
    is_estimated INTEGER NOT NULL DEFAULT 0 CHECK(is_estimated IN (0, 1)),
    liabilities_minor INTEGER NOT NULL DEFAULT 0,
    net_worth_minor INTEGER NOT NULL DEFAULT 0,
    rebuilt_at INTEGER NOT NULL,
    UNIQUE(household_id, fact_date)
  );
`;
