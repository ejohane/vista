CREATE TABLE `sync_checkpoints` (
  `provider_connection_id` text PRIMARY KEY NOT NULL,
  `cursor` text NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`provider_connection_id`) REFERENCES `provider_connections`(`id`)
);

CREATE INDEX `sync_checkpoints_updated_idx` ON `sync_checkpoints` (`updated_at`);

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

CREATE TABLE `investment_transactions` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `provider_transaction_id` text NOT NULL,
  `posted_at` integer NOT NULL,
  `trade_at` integer,
  `amount_minor` integer NOT NULL,
  `price_minor` integer,
  `fees_minor` integer,
  `quantity` text NOT NULL,
  `name` text NOT NULL,
  `security_id` text,
  `type` text NOT NULL,
  `subtype` text,
  `currency` text NOT NULL DEFAULT 'USD',
  `source_sync_run_id` text NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`),
  FOREIGN KEY (`source_sync_run_id`) REFERENCES `sync_runs`(`id`)
);

CREATE INDEX `investment_transactions_account_posted_idx` ON `investment_transactions` (`account_id`, `posted_at`);
CREATE INDEX `investment_transactions_run_idx` ON `investment_transactions` (`source_sync_run_id`);
CREATE UNIQUE INDEX `investment_transactions_account_provider_idx` ON `investment_transactions` (`account_id`, `provider_transaction_id`);