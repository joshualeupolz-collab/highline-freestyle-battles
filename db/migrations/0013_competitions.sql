ALTER TABLE `competitions` ADD `level` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `competitions` ADD `description` text;--> statement-breakpoint
CREATE INDEX `competitions_starts_idx` ON `competitions` (`starts_at`);