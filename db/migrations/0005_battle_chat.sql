CREATE TABLE `battle_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`battle_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`battle_id`) REFERENCES `battles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `battle_messages_battle_idx` ON `battle_messages` (`battle_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `battle_messages_sender_idx` ON `battle_messages` (`sender_id`);--> statement-breakpoint
ALTER TABLE `battle_participants` ADD `last_read_message_at` integer;