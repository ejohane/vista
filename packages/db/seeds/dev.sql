DELETE FROM balance_snapshots;
DELETE FROM sync_runs;
DELETE FROM accounts;
DELETE FROM households;

INSERT INTO households (`id`, `name`, `last_synced_at`, `created_at`)
VALUES (
  'household_demo',
  'Vista Household',
  CAST(strftime('%s', '2026-03-16 18:30:00') AS INTEGER) * 1000,
  CAST(strftime('%s', '2026-03-15 12:00:00') AS INTEGER) * 1000
);

INSERT INTO accounts (
  `id`,
  `household_id`,
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
