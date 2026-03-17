CREATE TABLE `sync_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `household_id` text NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('running', 'succeeded', 'failed')),
  `trigger` text NOT NULL CHECK (`trigger` IN ('seed', 'scheduled')),
  `started_at` integer NOT NULL,
  `completed_at` integer,
  FOREIGN KEY (`household_id`) REFERENCES `households`(`id`)
);

CREATE INDEX `sync_runs_household_idx` ON `sync_runs` (`household_id`);
CREATE INDEX `sync_runs_household_completed_idx` ON `sync_runs` (`household_id`, `completed_at`);

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
