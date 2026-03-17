DELETE FROM accounts;
DELETE FROM households;

INSERT INTO households (`id`, `name`, `last_synced_at`, `created_at`)
VALUES (
  'household_demo',
  'Vista Household',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
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
    CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  ),
  (
    'acct_savings',
    'household_demo',
    'Rainy Day Savings',
    'US Bank',
    'savings',
    'cash',
    3527600,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  ),
  (
    'acct_brokerage',
    'household_demo',
    'Taxable Brokerage',
    'Vanguard',
    'brokerage',
    'investments',
    16450320,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  ),
  (
    'acct_retirement',
    'household_demo',
    'Rollover IRA',
    'Vanguard',
    'retirement',
    'investments',
    24311890,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  );

