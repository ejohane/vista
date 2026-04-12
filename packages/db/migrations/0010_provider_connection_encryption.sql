ALTER TABLE `provider_connections` ADD COLUMN `access_token_encrypted` text;
ALTER TABLE `provider_connections` ADD COLUMN `access_secret_encrypted` text;
ALTER TABLE `provider_connections` ADD COLUMN `credential_key_version` integer DEFAULT 1;