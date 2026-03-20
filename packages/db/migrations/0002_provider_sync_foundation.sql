CREATE TABLE `provider_connections` (
  `id` text PRIMARY KEY NOT NULL,
  `household_id` text NOT NULL,
  `provider` text NOT NULL CHECK (`provider` IN ('simplefin', 'snaptrade')),
  `status` text NOT NULL CHECK (`status` IN ('active', 'disconnected', 'error')),
  `external_connection_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`household_id`) REFERENCES `households`(`id`)
);

CREATE INDEX `provider_connections_household_idx` ON `provider_connections` (`household_id`);
CREATE UNIQUE INDEX `provider_connections_provider_external_idx` ON `provider_connections` (`provider`, `external_connection_id`);

CREATE TABLE `provider_accounts` (
  `id` text PRIMARY KEY NOT NULL,
  `provider_connection_id` text NOT NULL,
  `provider_account_id` text NOT NULL,
  `name` text NOT NULL,
  `institution_name` text NOT NULL,
  `account_type` text NOT NULL CHECK (`account_type` IN ('checking', 'savings', 'brokerage', 'retirement')),
  `account_subtype` text,
  `currency` text NOT NULL DEFAULT 'USD',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`provider_connection_id`) REFERENCES `provider_connections`(`id`)
);

CREATE INDEX `provider_accounts_connection_idx` ON `provider_accounts` (`provider_connection_id`);
CREATE UNIQUE INDEX `provider_accounts_connection_native_idx` ON `provider_accounts` (`provider_connection_id`, `provider_account_id`);

ALTER TABLE `accounts` ADD COLUMN `provider_account_id` text REFERENCES `provider_accounts`(`id`);
ALTER TABLE `accounts` ADD COLUMN `display_name` text;
ALTER TABLE `accounts` ADD COLUMN `account_subtype` text;
ALTER TABLE `accounts` ADD COLUMN `currency` text NOT NULL DEFAULT 'USD';
ALTER TABLE `accounts` ADD COLUMN `ownership_type` text NOT NULL DEFAULT 'joint' CHECK (`ownership_type` IN ('mine', 'wife', 'joint'));
ALTER TABLE `accounts` ADD COLUMN `include_in_household_reporting` integer NOT NULL DEFAULT 1 CHECK (`include_in_household_reporting` IN (0, 1));
ALTER TABLE `accounts` ADD COLUMN `is_hidden` integer NOT NULL DEFAULT 0 CHECK (`is_hidden` IN (0, 1));

CREATE UNIQUE INDEX `accounts_provider_account_idx` ON `accounts` (`provider_account_id`) WHERE `provider_account_id` IS NOT NULL;

ALTER TABLE `sync_runs` ADD COLUMN `provider_connection_id` text REFERENCES `provider_connections`(`id`);
ALTER TABLE `sync_runs` ADD COLUMN `provider` text CHECK (`provider` IN ('simplefin', 'snaptrade'));
ALTER TABLE `sync_runs` ADD COLUMN `records_changed` integer NOT NULL DEFAULT 0;
ALTER TABLE `sync_runs` ADD COLUMN `error_summary` text;

CREATE INDEX `sync_runs_connection_idx` ON `sync_runs` (`provider_connection_id`);

CREATE TABLE `sync_checkpoints` (
  `id` text PRIMARY KEY NOT NULL,
  `provider_connection_id` text NOT NULL,
  `cursor` text,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`provider_connection_id`) REFERENCES `provider_connections`(`id`)
);

CREATE UNIQUE INDEX `sync_checkpoints_connection_idx` ON `sync_checkpoints` (`provider_connection_id`);

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
