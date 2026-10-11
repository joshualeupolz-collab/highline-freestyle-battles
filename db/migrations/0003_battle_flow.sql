ALTER TABLE `battles` ADD `invited_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `battles` ADD `decision_reason` text;--> statement-breakpoint
CREATE INDEX `battles_invited_idx` ON `battles` (`invited_user_id`,`status`);