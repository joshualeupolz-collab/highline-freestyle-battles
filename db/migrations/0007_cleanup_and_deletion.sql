ALTER TABLE `battles` ADD `ended_at` integer;--> statement-breakpoint
CREATE INDEX `battles_ended_idx` ON `battles` (`ended_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `deletion_token_hash` text;--> statement-breakpoint
-- Battles that ended before this column existed: decided ones at their decision, cancelled ones
-- at their creation (close enough for cleaning up their videos).
UPDATE `battles` SET `ended_at` = COALESCE(`decided_at`, `created_at`) WHERE `status` IN ('decided', 'cancelled', 'annulled');
