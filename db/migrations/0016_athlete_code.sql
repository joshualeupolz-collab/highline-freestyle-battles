ALTER TABLE `attempts` ADD `recorder_name` text;--> statement-breakpoint
ALTER TABLE `attempts` ADD `description` text;--> statement-breakpoint
ALTER TABLE `attempts` ADD `assignment` text;--> statement-breakpoint
ALTER TABLE `attempts` ADD `assigned_at` integer;--> statement-breakpoint
ALTER TABLE `attempts` ADD `confirmed_by` text REFERENCES users(id);