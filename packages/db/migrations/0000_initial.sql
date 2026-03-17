CREATE TABLE `households` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `last_synced_at` integer NOT NULL,
  `created_at` integer NOT NULL
);

CREATE TABLE `accounts` (
  `id` text PRIMARY KEY NOT NULL,
  `household_id` text NOT NULL,
  `name` text NOT NULL,
  `institution_name` text NOT NULL,
  `account_type` text NOT NULL CHECK (`account_type` IN ('checking', 'savings', 'brokerage', 'retirement')),
  `reporting_group` text NOT NULL CHECK (`reporting_group` IN ('cash', 'investments')),
  `balance_minor` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CHECK (
    (`account_type` IN ('checking', 'savings') AND `reporting_group` = 'cash')
    OR
    (`account_type` IN ('brokerage', 'retirement') AND `reporting_group` = 'investments')
  ),
  FOREIGN KEY (`household_id`) REFERENCES `households`(`id`)
);

CREATE INDEX `accounts_household_idx` ON `accounts` (`household_id`);
