CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`category` text NOT NULL,
	`text` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`closed_by` text,
	`closed_at` integer,
	`close_note` text,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reports_target_type_check" CHECK("reports"."target_type" IN ('battle', 'video', 'user')),
	CONSTRAINT "reports_category_check" CHECK("reports"."category" IN ('wrong_result', 'fake_account', 'inappropriate', 'privacy', 'other')),
	CONSTRAINT "reports_status_check" CHECK("reports"."status" IN ('open', 'closed'))
);
--> statement-breakpoint
CREATE INDEX `reports_status_idx` ON `reports` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `reports_target_idx` ON `reports` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `reports_reporter_idx` ON `reports` (`reporter_id`,`created_at`);