ALTER TABLE `users` ADD `athlete_code_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_athlete_code_key_unique` ON `users` (`athlete_code_key`);--> statement-breakpoint
-- Codes so far were random, 8 characters, stored without the dash: show them with the dash and
-- compare them by their key (lower case, no spaces or dashes; athleteCodeKey in @hfb/shared).
UPDATE `users` SET `athlete_code_key` = lower(`athlete_code`), `athlete_code` = substr(`athlete_code`, 1, 4) || '-' || substr(`athlete_code`, 5) WHERE `athlete_code` IS NOT NULL;--> statement-breakpoint
UPDATE `attempts` SET `code_used` = lower(`code_used`) WHERE `code_used` IS NOT NULL;
