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
  `account_type` text NOT NULL,
  `reporting_group` text NOT NULL,
  `balance_minor` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`household_id`) REFERENCES `households`(`id`)
);

CREATE INDEX `accounts_household_idx` ON `accounts` (`household_id`);

