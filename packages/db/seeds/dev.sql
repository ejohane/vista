DELETE FROM holding_snapshots;
DELETE FROM holdings;
DELETE FROM balance_snapshots;
DELETE FROM sync_runs;
DELETE FROM accounts;
DELETE FROM provider_accounts;
DELETE FROM provider_connections;
DELETE FROM households;

INSERT INTO households (`id`, `name`, `last_synced_at`, `created_at`)
VALUES (
  'household_demo',
  'Vista Household',
  CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000,
  CAST(strftime('%s', '2026-03-15 12:00:00') AS INTEGER) * 1000
);

INSERT INTO provider_connections (
  `id`,
  `household_id`,
  `provider`,
  `status`,
  `external_connection_id`,
  `access_token`,
  `institution_name`,
  `plaid_item_id`,
  `created_at`,
  `updated_at`
)
VALUES
  (
    'conn_plaid_us_bank',
    'household_demo',
    'plaid',
    'active',
    'plaid-demo-us-bank',
    'plaid-access-token-us-bank',
    'US Bank',
    'plaid-item-us-bank',
    CAST(strftime('%s', '2026-03-15 12:00:00') AS INTEGER) * 1000,
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000
  ),
  (
    'conn_plaid_vanguard',
    'household_demo',
    'plaid',
    'active',
    'plaid-demo-vanguard',
    'plaid-access-token-vanguard',
    'Vanguard',
    'plaid-item-vanguard',
    CAST(strftime('%s', '2026-03-15 12:00:00') AS INTEGER) * 1000,
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000
  );

INSERT INTO provider_accounts (
  `id`,
  `provider_connection_id`,
  `provider_account_id`,
  `name`,
  `institution_name`,
  `account_type`,
  `account_subtype`,
  `currency`,
  `created_at`,
  `updated_at`
)
VALUES
  (
    'prov_acct_checking',
    'conn_plaid_us_bank',
    'plaid-account-checking',
    'US Bank Platinum Checking',
    'US Bank',
    'checking',
    'checking',
    'USD',
    CAST(strftime('%s', '2026-03-15 12:00:00') AS INTEGER) * 1000,
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000
  ),
  (
    'prov_acct_savings',
    'conn_plaid_us_bank',
    'plaid-account-savings',
    'US Bank Savings',
    'US Bank',
    'savings',
    'savings',
    'USD',
    CAST(strftime('%s', '2026-03-15 12:00:00') AS INTEGER) * 1000,
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000
  ),
  (
    'prov_acct_brokerage',
    'conn_plaid_vanguard',
    'plaid-account-brokerage',
    'Vanguard Taxable Brokerage',
    'Vanguard',
    'brokerage',
    'brokerage',
    'USD',
    CAST(strftime('%s', '2026-03-15 12:00:00') AS INTEGER) * 1000,
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000
  ),
  (
    'prov_acct_retirement',
    'conn_plaid_vanguard',
    'plaid-account-retirement',
    'Vanguard Rollover IRA',
    'Vanguard',
    'retirement',
    'ira',
    'USD',
    CAST(strftime('%s', '2026-03-15 12:00:00') AS INTEGER) * 1000,
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000
  );

INSERT INTO accounts (
  `id`,
  `household_id`,
  `provider_account_id`,
  `name`,
  `institution_name`,
  `account_type`,
  `reporting_group`,
  `balance_minor`,
  `created_at`,
  `updated_at`
)
VALUES
  (
    'acct_checking',
    'household_demo',
    'prov_acct_checking',
    'Everyday Checking',
    'US Bank',
    'checking',
    'cash',
    1284500,
    CAST(strftime('%s', '2026-03-15 12:00:00') AS INTEGER) * 1000,
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000
  ),
  (
    'acct_savings',
    'household_demo',
    'prov_acct_savings',
    'Rainy Day Savings',
    'US Bank',
    'savings',
    'cash',
    3527600,
    CAST(strftime('%s', '2026-03-15 12:00:00') AS INTEGER) * 1000,
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000
  ),
  (
    'acct_brokerage',
    'household_demo',
    'prov_acct_brokerage',
    'Taxable Brokerage',
    'Vanguard',
    'brokerage',
    'investments',
    16450320,
    CAST(strftime('%s', '2026-03-15 12:00:00') AS INTEGER) * 1000,
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000
  ),
  (
    'acct_retirement',
    'household_demo',
    'prov_acct_retirement',
    'Rollover IRA',
    'Vanguard',
    'retirement',
    'investments',
    24311890,
    CAST(strftime('%s', '2026-03-15 12:00:00') AS INTEGER) * 1000,
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000
  );

INSERT INTO sync_runs (
  `id`,
  `household_id`,
  `status`,
  `trigger`,
  `started_at`,
  `completed_at`
)
VALUES
  (
    'sync_seed_2026_03_15',
    'household_demo',
    'succeeded',
    'seed',
    CAST(strftime('%s', '2026-03-15 18:25:00') AS INTEGER) * 1000,
    CAST(strftime('%s', '2026-03-15 18:30:00') AS INTEGER) * 1000
  ),
  (
    'sync_seed_2026_03_16',
    'household_demo',
    'succeeded',
    'seed',
    CAST(strftime('%s', '2026-03-16 18:25:00') AS INTEGER) * 1000,
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000
  );

INSERT INTO balance_snapshots (
  `id`,
  `account_id`,
  `source_sync_run_id`,
  `captured_at`,
  `as_of_date`,
  `balance_minor`
)
VALUES
  (
    'snapshot_sync_seed_2026_03_15_acct_checking',
    'acct_checking',
    'sync_seed_2026_03_15',
    CAST(strftime('%s', '2026-03-15 18:30:00') AS INTEGER) * 1000,
    '2026-03-15',
    1240000
  ),
  (
    'snapshot_sync_seed_2026_03_15_acct_savings',
    'acct_savings',
    'sync_seed_2026_03_15',
    CAST(strftime('%s', '2026-03-15 18:30:00') AS INTEGER) * 1000,
    '2026-03-15',
    3500000
  ),
  (
    'snapshot_sync_seed_2026_03_15_acct_brokerage',
    'acct_brokerage',
    'sync_seed_2026_03_15',
    CAST(strftime('%s', '2026-03-15 18:30:00') AS INTEGER) * 1000,
    '2026-03-15',
    16180000
  ),
  (
    'snapshot_sync_seed_2026_03_15_acct_retirement',
    'acct_retirement',
    'sync_seed_2026_03_15',
    CAST(strftime('%s', '2026-03-15 18:30:00') AS INTEGER) * 1000,
    '2026-03-15',
    24280000
  ),
  (
    'snapshot_sync_seed_2026_03_16_acct_checking',
    'acct_checking',
    'sync_seed_2026_03_16',
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000,
    '2026-03-16',
    1284500
  ),
  (
    'snapshot_sync_seed_2026_03_16_acct_savings',
    'acct_savings',
    'sync_seed_2026_03_16',
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000,
    '2026-03-16',
    3527600
  ),
  (
    'snapshot_sync_seed_2026_03_16_acct_brokerage',
    'acct_brokerage',
    'sync_seed_2026_03_16',
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000,
    '2026-03-16',
    16450320
  ),
  (
    'snapshot_sync_seed_2026_03_16_acct_retirement',
    'acct_retirement',
    'sync_seed_2026_03_16',
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000,
    '2026-03-16',
    24311890
  );

INSERT INTO holdings (
  `id`,
  `account_id`,
  `holding_key`,
  `symbol`,
  `name`,
  `asset_class`,
  `sub_asset_class`,
  `currency`,
  `created_at`,
  `updated_at`
)
VALUES
  (
    'holding_cash_brokerage',
    'acct_brokerage',
    'cash:USD',
    'USD',
    'USD Cash',
    'cash',
    'Brokerage cash',
    'USD',
    CAST(strftime('%s', '2026-03-15 12:00:00') AS INTEGER) * 1000,
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000
  ),
  (
    'holding_vti',
    'acct_brokerage',
    'symbol:vti',
    'VTI',
    'Vanguard Total Stock Market ETF',
    'equity',
    'ETF',
    'USD',
    CAST(strftime('%s', '2026-03-15 12:00:00') AS INTEGER) * 1000,
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000
  ),
  (
    'holding_bnd',
    'acct_brokerage',
    'symbol:bnd',
    'BND',
    'Vanguard Total Bond Market ETF',
    'fixed_income',
    'Bond ETF',
    'USD',
    CAST(strftime('%s', '2026-03-15 12:00:00') AS INTEGER) * 1000,
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000
  ),
  (
    'holding_cash_retirement',
    'acct_retirement',
    'cash:USD',
    'USD',
    'USD Cash',
    'cash',
    'Retirement cash',
    'USD',
    CAST(strftime('%s', '2026-03-15 12:00:00') AS INTEGER) * 1000,
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000
  ),
  (
    'holding_vxus',
    'acct_retirement',
    'symbol:vxus',
    'VXUS',
    'Vanguard Total International Stock ETF',
    'equity',
    'ETF',
    'USD',
    CAST(strftime('%s', '2026-03-15 12:00:00') AS INTEGER) * 1000,
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000
  );

INSERT INTO holding_snapshots (
  `id`,
  `holding_id`,
  `account_id`,
  `source_sync_run_id`,
  `captured_at`,
  `as_of_date`,
  `quantity`,
  `price_minor`,
  `market_value_minor`,
  `cost_basis_minor`
)
VALUES
  (
    'holding_snapshot_cash_brokerage',
    'holding_cash_brokerage',
    'acct_brokerage',
    'sync_seed_2026_03_16',
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000,
    '2026-03-16',
    '320.12',
    100,
    32012,
    32012
  ),
  (
    'holding_snapshot_vti',
    'holding_vti',
    'acct_brokerage',
    'sync_seed_2026_03_16',
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000,
    '2026-03-16',
    '542.10',
    30033,
    16280829,
    14010300
  ),
  (
    'holding_snapshot_bnd',
    'holding_bnd',
    'acct_brokerage',
    'sync_seed_2026_03_16',
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000,
    '2026-03-16',
    '17.00',
    8064,
    137088,
    129540
  ),
  (
    'holding_snapshot_cash_retirement',
    'holding_cash_retirement',
    'acct_retirement',
    'sync_seed_2026_03_16',
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000,
    '2026-03-16',
    '210.00',
    100,
    21000,
    21000
  ),
  (
    'holding_snapshot_vxus',
    'holding_vxus',
    'acct_retirement',
    'sync_seed_2026_03_16',
    CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000,
    '2026-03-16',
    '306.50',
    7922,
    24290890,
    20110000
  );
