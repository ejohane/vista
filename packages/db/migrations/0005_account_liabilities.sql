CREATE TABLE `__backup_provider_accounts` AS
SELECT
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
FROM `provider_accounts`;

CREATE TABLE `__backup_accounts` AS
SELECT
  `id`,
  `household_id`,
  `name`,
  `institution_name`,
  `account_type`,
  `reporting_group`,
  `balance_minor`,
  `created_at`,
  `updated_at`,
  `provider_account_id`,
  `display_name`,
  `account_subtype`,
  `currency`,
  `ownership_type`,
  `include_in_household_reporting`,
  `is_hidden`
FROM `accounts`;

CREATE TABLE `__backup_balance_snapshots` AS
SELECT
  `id`,
  `account_id`,
  `source_sync_run_id`,
  `captured_at`,
  `as_of_date`,
  `balance_minor`
FROM `balance_snapshots`;

CREATE TABLE `__backup_transactions` AS
SELECT
  `id`,
  `account_id`,
  `provider_transaction_id`,
  `posted_at`,
  `amount_minor`,
  `direction`,
  `description`,
  `merchant_name`,
  `category_raw`,
  `category_normalized`,
  `exclude_from_reporting`,
  `source_sync_run_id`
FROM `transactions`;

CREATE TABLE `__backup_holdings` AS
SELECT
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
FROM `holdings`;

CREATE TABLE `__backup_holding_snapshots` AS
SELECT
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
FROM `holding_snapshots`;

DROP TABLE `holding_snapshots`;
DROP TABLE `holdings`;
DROP TABLE `transactions`;
DROP TABLE `balance_snapshots`;
DROP TABLE `accounts`;
DROP TABLE `provider_accounts`;

CREATE TABLE `provider_accounts` (
  `id` text PRIMARY KEY NOT NULL,
  `provider_connection_id` text NOT NULL,
  `provider_account_id` text NOT NULL,
  `name` text NOT NULL,
  `institution_name` text NOT NULL,
  `account_type` text NOT NULL CHECK (`account_type` IN ('checking', 'savings', 'credit_card', 'brokerage', 'retirement')),
  `account_subtype` text,
  `currency` text NOT NULL DEFAULT 'USD',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`provider_connection_id`) REFERENCES `provider_connections`(`id`)
);

CREATE INDEX `provider_accounts_connection_idx` ON `provider_accounts` (`provider_connection_id`);
CREATE UNIQUE INDEX `provider_accounts_connection_native_idx` ON `provider_accounts` (`provider_connection_id`, `provider_account_id`);

CREATE TABLE `accounts` (
  `id` text PRIMARY KEY NOT NULL,
  `household_id` text NOT NULL,
  `name` text NOT NULL,
  `institution_name` text NOT NULL,
  `account_type` text NOT NULL CHECK (`account_type` IN ('checking', 'savings', 'credit_card', 'brokerage', 'retirement')),
  `reporting_group` text NOT NULL CHECK (`reporting_group` IN ('cash', 'liabilities', 'investments')),
  `balance_minor` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `provider_account_id` text REFERENCES `provider_accounts`(`id`),
  `display_name` text,
  `account_subtype` text,
  `currency` text NOT NULL DEFAULT 'USD',
  `ownership_type` text NOT NULL DEFAULT 'joint' CHECK (`ownership_type` IN ('mine', 'wife', 'joint')),
  `include_in_household_reporting` integer NOT NULL DEFAULT 1 CHECK (`include_in_household_reporting` IN (0, 1)),
  `is_hidden` integer NOT NULL DEFAULT 0 CHECK (`is_hidden` IN (0, 1)),
  CHECK (
    (`account_type` IN ('checking', 'savings') AND `reporting_group` = 'cash')
    OR
    (`account_type` = 'credit_card' AND `reporting_group` = 'liabilities')
    OR
    (`account_type` IN ('brokerage', 'retirement') AND `reporting_group` = 'investments')
  ),
  FOREIGN KEY (`household_id`) REFERENCES `households`(`id`)
);

CREATE INDEX `accounts_household_idx` ON `accounts` (`household_id`);
CREATE UNIQUE INDEX `accounts_provider_account_idx` ON `accounts` (`provider_account_id`) WHERE `provider_account_id` IS NOT NULL;

CREATE TABLE `balance_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `source_sync_run_id` text NOT NULL,
  `captured_at` integer NOT NULL,
  `as_of_date` text NOT NULL,
  `balance_minor` integer NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`),
  FOREIGN KEY (`source_sync_run_id`) REFERENCES `sync_runs`(`id`)
);

CREATE INDEX `balance_snapshots_run_idx` ON `balance_snapshots` (`source_sync_run_id`);
CREATE INDEX `balance_snapshots_account_idx` ON `balance_snapshots` (`account_id`);
CREATE UNIQUE INDEX `balance_snapshots_account_run_idx` ON `balance_snapshots` (`account_id`, `source_sync_run_id`);

CREATE TABLE `transactions` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `provider_transaction_id` text NOT NULL,
  `posted_at` integer NOT NULL,
  `amount_minor` integer NOT NULL,
  `direction` text NOT NULL CHECK (`direction` IN ('credit', 'debit')),
  `description` text NOT NULL,
  `merchant_name` text,
  `category_raw` text,
  `category_normalized` text,
  `exclude_from_reporting` integer NOT NULL DEFAULT 0 CHECK (`exclude_from_reporting` IN (0, 1)),
  `source_sync_run_id` text NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`),
  FOREIGN KEY (`source_sync_run_id`) REFERENCES `sync_runs`(`id`)
);

CREATE INDEX `transactions_account_posted_idx` ON `transactions` (`account_id`, `posted_at`);
CREATE INDEX `transactions_run_idx` ON `transactions` (`source_sync_run_id`);
CREATE UNIQUE INDEX `transactions_account_provider_idx` ON `transactions` (`account_id`, `provider_transaction_id`);

CREATE TABLE `holdings` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `holding_key` text NOT NULL,
  `symbol` text,
  `name` text NOT NULL,
  `asset_class` text NOT NULL CHECK (`asset_class` IN ('cash', 'equity', 'fixed_income', 'crypto', 'fund', 'other')),
  `sub_asset_class` text,
  `currency` text NOT NULL DEFAULT 'USD',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`)
);

CREATE INDEX `holdings_account_idx` ON `holdings` (`account_id`);
CREATE UNIQUE INDEX `holdings_account_key_idx` ON `holdings` (`account_id`, `holding_key`);

CREATE TABLE `holding_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `holding_id` text NOT NULL,
  `account_id` text NOT NULL,
  `source_sync_run_id` text NOT NULL,
  `captured_at` integer NOT NULL,
  `as_of_date` text NOT NULL,
  `quantity` text NOT NULL,
  `price_minor` integer,
  `market_value_minor` integer NOT NULL,
  `cost_basis_minor` integer,
  FOREIGN KEY (`holding_id`) REFERENCES `holdings`(`id`),
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`),
  FOREIGN KEY (`source_sync_run_id`) REFERENCES `sync_runs`(`id`)
);

CREATE INDEX `holding_snapshots_account_idx` ON `holding_snapshots` (`account_id`);
CREATE INDEX `holding_snapshots_run_idx` ON `holding_snapshots` (`source_sync_run_id`);
CREATE UNIQUE INDEX `holding_snapshots_holding_run_idx` ON `holding_snapshots` (`holding_id`, `source_sync_run_id`);

INSERT INTO `provider_accounts` (
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
SELECT
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
FROM `__backup_provider_accounts`;

INSERT INTO `accounts` (
  `id`,
  `household_id`,
  `name`,
  `institution_name`,
  `account_type`,
  `reporting_group`,
  `balance_minor`,
  `created_at`,
  `updated_at`,
  `provider_account_id`,
  `display_name`,
  `account_subtype`,
  `currency`,
  `ownership_type`,
  `include_in_household_reporting`,
  `is_hidden`
)
SELECT
  `id`,
  `household_id`,
  `name`,
  `institution_name`,
  `account_type`,
  `reporting_group`,
  `balance_minor`,
  `created_at`,
  `updated_at`,
  `provider_account_id`,
  `display_name`,
  `account_subtype`,
  `currency`,
  `ownership_type`,
  `include_in_household_reporting`,
  `is_hidden`
FROM `__backup_accounts`;

INSERT INTO `balance_snapshots` (
  `id`,
  `account_id`,
  `source_sync_run_id`,
  `captured_at`,
  `as_of_date`,
  `balance_minor`
)
SELECT
  `id`,
  `account_id`,
  `source_sync_run_id`,
  `captured_at`,
  `as_of_date`,
  `balance_minor`
FROM `__backup_balance_snapshots`;

INSERT INTO `transactions` (
  `id`,
  `account_id`,
  `provider_transaction_id`,
  `posted_at`,
  `amount_minor`,
  `direction`,
  `description`,
  `merchant_name`,
  `category_raw`,
  `category_normalized`,
  `exclude_from_reporting`,
  `source_sync_run_id`
)
SELECT
  `id`,
  `account_id`,
  `provider_transaction_id`,
  `posted_at`,
  `amount_minor`,
  `direction`,
  `description`,
  `merchant_name`,
  `category_raw`,
  `category_normalized`,
  `exclude_from_reporting`,
  `source_sync_run_id`
FROM `__backup_transactions`;

INSERT INTO `holdings` (
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
SELECT
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
FROM `__backup_holdings`;

INSERT INTO `holding_snapshots` (
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
SELECT
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
FROM `__backup_holding_snapshots`;

DROP TABLE `__backup_holding_snapshots`;
DROP TABLE `__backup_holdings`;
DROP TABLE `__backup_transactions`;
DROP TABLE `__backup_balance_snapshots`;
DROP TABLE `__backup_accounts`;
DROP TABLE `__backup_provider_accounts`;
