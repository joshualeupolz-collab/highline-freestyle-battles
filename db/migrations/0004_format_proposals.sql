ALTER TABLE `formats` ADD `approved_at` integer;--> statement-breakpoint
ALTER TABLE `formats` ADD `approved_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `formats` ADD `review_note` text;--> statement-breakpoint
CREATE INDEX `formats_created_by_idx` ON `formats` (`created_by`);--> statement-breakpoint
-- Formats that existed before proposals were introduced count as approved.
UPDATE `formats` SET `approved_at` = `created_at` WHERE `approved_at` IS NULL;
