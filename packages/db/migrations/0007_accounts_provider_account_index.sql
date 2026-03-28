DROP INDEX IF EXISTS `accounts_provider_account_idx`;

CREATE UNIQUE INDEX `accounts_provider_account_idx`
ON `accounts` (`provider_account_id`);