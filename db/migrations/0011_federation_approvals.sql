CREATE TABLE `federation_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`reason` text NOT NULL,
	`payload_json` text,
	`requested_by` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`decision_note` text,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "federation_approvals_action_check" CHECK("federation_approvals"."action" IN ('battle.annul')),
	CONSTRAINT "federation_approvals_status_check" CHECK("federation_approvals"."status" IN ('pending', 'approved', 'rejected', 'withdrawn'))
);
--> statement-breakpoint
CREATE INDEX `federation_approvals_status_idx` ON `federation_approvals` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `federation_approvals_target_idx` ON `federation_approvals` (`target_type`,`target_id`);