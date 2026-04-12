CREATE TABLE `members` (
  `id` text PRIMARY KEY NOT NULL,
  `household_id` text NOT NULL REFERENCES `households`(`id`),
  `role` text NOT NULL,
  `display_name` text,
  `email` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT `members_role_check` CHECK (`role` in ('owner', 'member'))
);

CREATE INDEX `members_household_idx` ON `members` (`household_id`);

CREATE TABLE `user_identities` (
  `id` text PRIMARY KEY NOT NULL,
  `member_id` text NOT NULL REFERENCES `members`(`id`),
  `provider` text NOT NULL,
  `provider_user_id` text NOT NULL,
  `email` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `last_seen_at` integer NOT NULL,
  CONSTRAINT `user_identities_provider_check` CHECK (`provider` in ('clerk'))
);

CREATE INDEX `user_identities_member_idx` ON `user_identities` (`member_id`);
CREATE UNIQUE INDEX `user_identities_provider_user_idx` ON `user_identities` (`provider`, `provider_user_id`);