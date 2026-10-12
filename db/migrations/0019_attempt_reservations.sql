CREATE TABLE `attempt_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`battle_id` text NOT NULL,
	`user_id` text NOT NULL,
	`part_index` integer NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`count` integer NOT NULL,
	`requested` integer NOT NULL,
	`device_code` text NOT NULL,
	`takeover` integer DEFAULT false NOT NULL,
	`code_used` text,
	`recorder_name` text,
	`created_at` integer NOT NULL,
	`reported_at` integer,
	`closed_at` integer,
	FOREIGN KEY (`battle_id`) REFERENCES `battles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attempt_reservations_count_check" CHECK("attempt_reservations"."count" >= 0 AND "attempt_reservations"."requested" >= 0)
);
--> statement-breakpoint
CREATE INDEX `attempt_reservations_battle_idx` ON `attempt_reservations` (`battle_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `attempt_reservations_user_idx` ON `attempt_reservations` (`user_id`,`closed_at`);--> statement-breakpoint
ALTER TABLE `attempts` ADD `device_code` text;--> statement-breakpoint
ALTER TABLE `attempts` ADD `reservation_id` text;