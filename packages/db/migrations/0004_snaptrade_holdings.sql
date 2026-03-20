ALTER TABLE `provider_connections` ADD COLUMN `access_secret` text;

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
