PRAGMA foreign_keys = OFF;

CREATE TABLE `__backup_provider_connections` AS
SELECT
  `id`,
  `household_id`,
  `provider`,
  `status`,
  `external_connection_id`,
  `access_token`,
  `access_secret`,
  `access_url`,
  `institution_id`,
  `institution_name`,
  `plaid_item_id`,
  `created_at`,
  `updated_at`
FROM `provider_connections`;

CREATE TABLE `__backup_sync_runs` AS
SELECT
  `id`,
  `household_id`,
  `status`,
  `trigger`,
  `started_at`,
  `completed_at`,
  `provider_connection_id`,
  `provider`,
  `records_changed`,
  `error_summary`
FROM `sync_runs`;

UPDATE `accounts`
SET `provider_account_id` = NULL
WHERE `provider_account_id` IN (
  SELECT `provider_accounts`.`id`
  FROM `provider_accounts`
  INNER JOIN `provider_connections`
    ON `provider_accounts`.`provider_connection_id` = `provider_connections`.`id`
  WHERE `provider_connections`.`provider` != 'plaid'
);

DELETE FROM `provider_accounts`
WHERE `provider_connection_id` IN (
  SELECT `id`
  FROM `provider_connections`
  WHERE `provider` != 'plaid'
);

DROP TABLE `sync_runs`;
DROP TABLE `provider_connections`;
DROP TABLE `sync_checkpoints`;
DROP TABLE `transactions`;

CREATE TABLE `provider_connections` (
  `id` text PRIMARY KEY NOT NULL,
  `household_id` text NOT NULL,
  `provider` text NOT NULL CHECK (`provider` IN ('plaid')),
  `status` text NOT NULL CHECK (`status` IN ('active', 'disconnected', 'error')),
  `external_connection_id` text NOT NULL,
  `access_token` text,
  `access_secret` text,
  `access_url` text,
  `institution_id` text,
  `institution_name` text,
  `plaid_item_id` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`household_id`) REFERENCES `households`(`id`)
);

CREATE INDEX `provider_connections_household_idx` ON `provider_connections` (`household_id`);
CREATE UNIQUE INDEX `provider_connections_provider_external_idx` ON `provider_connections` (`provider`, `external_connection_id`);

CREATE TABLE `sync_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `household_id` text NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('running', 'succeeded', 'failed')),
  `trigger` text NOT NULL CHECK (`trigger` IN ('seed', 'scheduled')),
  `started_at` integer NOT NULL,
  `completed_at` integer,
  `provider_connection_id` text REFERENCES `provider_connections`(`id`),
  `provider` text CHECK (`provider` IS NULL OR `provider` IN ('plaid')),
  `records_changed` integer NOT NULL DEFAULT 0,
  `error_summary` text,
  FOREIGN KEY (`household_id`) REFERENCES `households`(`id`)
);

CREATE INDEX `sync_runs_household_idx` ON `sync_runs` (`household_id`);
CREATE INDEX `sync_runs_household_completed_idx` ON `sync_runs` (`household_id`, `completed_at`);
CREATE INDEX `sync_runs_connection_idx` ON `sync_runs` (`provider_connection_id`);

INSERT INTO `provider_connections` (
  `id`,
  `household_id`,
  `provider`,
  `status`,
  `external_connection_id`,
  `access_token`,
  `access_secret`,
  `access_url`,
  `institution_id`,
  `institution_name`,
  `plaid_item_id`,
  `created_at`,
  `updated_at`
)
SELECT
  `id`,
  `household_id`,
  `provider`,
  `status`,
  `external_connection_id`,
  `access_token`,
  `access_secret`,
  `access_url`,
  `institution_id`,
  `institution_name`,
  `plaid_item_id`,
  `created_at`,
  `updated_at`
FROM `__backup_provider_connections`
WHERE `provider` = 'plaid';

INSERT INTO `sync_runs` (
  `id`,
  `household_id`,
  `status`,
  `trigger`,
  `started_at`,
  `completed_at`,
  `provider_connection_id`,
  `provider`,
  `records_changed`,
  `error_summary`
)
SELECT
  `id`,
  `household_id`,
  `status`,
  `trigger`,
  `started_at`,
  `completed_at`,
  CASE
    WHEN `provider` = 'plaid' THEN `provider_connection_id`
    ELSE NULL
  END,
  CASE
    WHEN `provider` = 'plaid' THEN `provider`
    ELSE NULL
  END,
  `records_changed`,
  `error_summary`
FROM `__backup_sync_runs`;

DROP TABLE `__backup_provider_connections`;
DROP TABLE `__backup_sync_runs`;

PRAGMA foreign_keys = ON;
