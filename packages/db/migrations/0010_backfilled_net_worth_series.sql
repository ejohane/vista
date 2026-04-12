CREATE TABLE `securities` (
  `id` text PRIMARY KEY NOT NULL,
  `provider` text NOT NULL CHECK (`provider` IN ('plaid')),
  `provider_security_id` text NOT NULL,
  `symbol` text,
  `name` text NOT NULL,
  `security_type` text,
  `security_subtype` text,
  `currency` text NOT NULL DEFAULT 'USD',
  `price_source` text NOT NULL CHECK (`price_source` IN ('alpha_vantage', 'plaid_holdings', 'missing')),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE UNIQUE INDEX `securities_provider_security_idx` ON `securities` (`provider`, `provider_security_id`);
CREATE INDEX `securities_symbol_idx` ON `securities` (`symbol`);

CREATE TABLE `security_price_daily` (
  `security_id` text NOT NULL,
  `price_date` text NOT NULL,
  `close_price_minor` integer,
  `currency` text NOT NULL DEFAULT 'USD',
  `source` text NOT NULL CHECK (`source` IN ('alpha_vantage', 'plaid_holdings', 'missing')),
  `is_estimated` integer NOT NULL DEFAULT 0 CHECK (`is_estimated` IN (0, 1)),
  `fetched_at` integer NOT NULL,
  FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`)
);

CREATE UNIQUE INDEX `security_price_daily_security_date_idx` ON `security_price_daily` (`security_id`, `price_date`);
CREATE INDEX `security_price_daily_date_idx` ON `security_price_daily` (`price_date`);

CREATE TABLE `daily_security_position_facts` (
  `household_id` text NOT NULL,
  `account_id` text NOT NULL,
  `security_id` text NOT NULL,
  `position_date` text NOT NULL,
  `quantity` text NOT NULL,
  `cost_basis_minor` integer,
  `source_window_start` text NOT NULL,
  `source_window_end` text NOT NULL,
  `is_estimated` integer NOT NULL DEFAULT 0 CHECK (`is_estimated` IN (0, 1)),
  `rebuilt_at` integer NOT NULL,
  FOREIGN KEY (`household_id`) REFERENCES `households`(`id`),
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`),
  FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`)
);

CREATE UNIQUE INDEX `daily_security_position_facts_account_security_date_idx` ON `daily_security_position_facts` (`account_id`, `security_id`, `position_date`);
CREATE INDEX `daily_security_position_facts_household_date_idx` ON `daily_security_position_facts` (`household_id`, `position_date`);

CREATE TABLE `daily_investment_account_value_facts` (
  `household_id` text NOT NULL,
  `account_id` text NOT NULL,
  `fact_date` text NOT NULL,
  `market_value_minor` integer NOT NULL DEFAULT 0,
  `cost_basis_minor` integer NOT NULL DEFAULT 0,
  `priced_position_count` integer NOT NULL DEFAULT 0,
  `missing_price_count` integer NOT NULL DEFAULT 0,
  `is_estimated` integer NOT NULL DEFAULT 0 CHECK (`is_estimated` IN (0, 1)),
  `rebuilt_at` integer NOT NULL,
  FOREIGN KEY (`household_id`) REFERENCES `households`(`id`),
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`)
);

CREATE UNIQUE INDEX `daily_investment_account_value_facts_account_date_idx` ON `daily_investment_account_value_facts` (`account_id`, `fact_date`);
CREATE INDEX `daily_investment_account_value_facts_household_date_idx` ON `daily_investment_account_value_facts` (`household_id`, `fact_date`);

CREATE TABLE `daily_net_worth_facts` (
  `household_id` text NOT NULL,
  `fact_date` text NOT NULL,
  `cash_minor` integer NOT NULL DEFAULT 0,
  `investments_minor` integer NOT NULL DEFAULT 0,
  `liabilities_minor` integer NOT NULL DEFAULT 0,
  `net_worth_minor` integer NOT NULL DEFAULT 0,
  `coverage_mode` text NOT NULL CHECK (`coverage_mode` IN ('snapshot_only', 'investments_backfilled', 'mixed_snapshot_and_backfill')),
  `is_estimated` integer NOT NULL DEFAULT 0 CHECK (`is_estimated` IN (0, 1)),
  `rebuilt_at` integer NOT NULL,
  FOREIGN KEY (`household_id`) REFERENCES `households`(`id`)
);

CREATE UNIQUE INDEX `daily_net_worth_facts_household_date_idx` ON `daily_net_worth_facts` (`household_id`, `fact_date`);