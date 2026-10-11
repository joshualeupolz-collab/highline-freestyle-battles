CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`battle_id` text,
	`user_id` text NOT NULL,
	`part_index` integer NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`started_at_client` integer NOT NULL,
	`synced_at` integer NOT NULL,
	`recorded_by` text,
	`code_used` text,
	`opponent_name_entered` text,
	FOREIGN KEY (`battle_id`) REFERENCES `battles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attempts_slot_idx` ON `attempts` (`battle_id`,`user_id`,`part_index`,`round`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`reason` text,
	`payload_json` text,
	`federation_approval_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`federation_approval_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audit_log_payload_json_check" CHECK("audit_log"."payload_json" IS NULL OR json_valid("audit_log"."payload_json"))
);
--> statement-breakpoint
CREATE INDEX `audit_log_target_idx` ON `audit_log` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`actor_id`);--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `battle_participants` (
	`battle_id` text NOT NULL,
	`user_id` text NOT NULL,
	`seat` integer NOT NULL,
	`joined_at` integer NOT NULL,
	`extra_attempts` integer DEFAULT 0 NOT NULL,
	`score` real,
	`points` real,
	`placement` integer,
	PRIMARY KEY(`battle_id`, `user_id`),
	FOREIGN KEY (`battle_id`) REFERENCES `battles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "battle_participants_seat_check" CHECK("battle_participants"."seat" >= 0),
	CONSTRAINT "battle_participants_extra_check" CHECK("battle_participants"."extra_attempts" >= 0),
	CONSTRAINT "battle_participants_score_check" CHECK("battle_participants"."score" IS NULL OR "battle_participants"."score" BETWEEN 0 AND 1),
	CONSTRAINT "battle_participants_points_check" CHECK("battle_participants"."points" IS NULL OR "battle_participants"."points" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `battle_participants_seat_unique` ON `battle_participants` (`battle_id`,`seat`);--> statement-breakpoint
CREATE INDEX `battle_participants_user_idx` ON `battle_participants` (`user_id`);--> statement-breakpoint
CREATE TABLE `battle_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`battle_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`proposed_by` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`battle_id`) REFERENCES `battles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "battle_proposals_kind_check" CHECK("battle_proposals"."kind" IN ('settings', 'result', 'draw', 'cancel', 'extra_attempt', 'extension')),
	CONSTRAINT "battle_proposals_status_check" CHECK("battle_proposals"."status" IN ('pending', 'accepted', 'rejected', 'withdrawn')),
	CONSTRAINT "battle_proposals_payload_json_check" CHECK(json_valid("battle_proposals"."payload_json"))
);
--> statement-breakpoint
CREATE INDEX `battle_proposals_battle_idx` ON `battle_proposals` (`battle_id`,`status`);--> statement-breakpoint
CREATE TABLE `battles` (
	`id` text PRIMARY KEY NOT NULL,
	`format_id` text NOT NULL,
	`format_version` integer NOT NULL,
	`ruleset_version` integer NOT NULL,
	`kind` text DEFAULT 'single' NOT NULL,
	`mode` text DEFAULT 'online' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`level` integer DEFAULT 3 NOT NULL,
	`level_approved_by` text,
	`level_approved_at` integer,
	`scoring` text DEFAULT 'scale' NOT NULL,
	`review_mode` text DEFAULT 'quick' NOT NULL,
	`review_level` integer DEFAULT 1 NOT NULL,
	`rounds` integer DEFAULT 1 NOT NULL,
	`attempts_per_video` integer,
	`time_window_hours` integer,
	`deadline_at` integer,
	`settings_flexible` integer DEFAULT false NOT NULL,
	`competition_id` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`accepted_at` integer,
	`played_at` integer,
	`decided_at` integer,
	`event_at` integer,
	`cancel_reason` text,
	`annulled_by` text,
	`annulled_at` integer,
	`annul_reason` text,
	FOREIGN KEY (`ruleset_version`) REFERENCES `rulesets`(`version`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`annulled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`format_id`,`format_version`) REFERENCES `format_versions`(`format_id`,`version`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "battles_kind_check" CHECK("battles"."kind" IN ('single', 'group', 'placement')),
	CONSTRAINT "battles_mode_check" CHECK("battles"."mode" IN ('online', 'onsite')),
	CONSTRAINT "battles_status_check" CHECK("battles"."status" IN ('open', 'negotiating', 'active', 'reviewing', 'decided', 'cancelled', 'annulled')),
	CONSTRAINT "battles_scoring_check" CHECK("battles"."scoring" IN ('win_loss', 'scale', 'points', 'placement')),
	CONSTRAINT "battles_review_mode_check" CHECK("battles"."review_mode" IN ('quick', 'detailed')),
	CONSTRAINT "battles_level_check" CHECK("battles"."level" BETWEEN 1 AND 5),
	CONSTRAINT "battles_review_level_check" CHECK("battles"."review_level" BETWEEN 1 AND 3),
	CONSTRAINT "battles_rounds_check" CHECK("battles"."rounds" >= 1),
	CONSTRAINT "battles_attempts_check" CHECK("battles"."attempts_per_video" IS NULL OR "battles"."attempts_per_video" >= 1)
);
--> statement-breakpoint
CREATE INDEX `battles_open_idx` ON `battles` (`status`,`format_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `battles_replay_idx` ON `battles` (`format_id`,`event_at`);--> statement-breakpoint
CREATE INDEX `battles_competition_idx` ON `battles` (`competition_id`);--> statement-breakpoint
CREATE TABLE `competitions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`organizer_id` text NOT NULL,
	`location` text,
	`starts_at` integer,
	`ends_at` integer,
	`status` text DEFAULT 'planned' NOT NULL,
	`confirmed_by` text,
	`confirmed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organizer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "competitions_status_check" CHECK("competitions"."status" IN ('planned', 'running', 'finished', 'confirmed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE `format_versions` (
	`format_id` text NOT NULL,
	`version` integer NOT NULL,
	`parts_json` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`format_id`, `version`),
	FOREIGN KEY (`format_id`) REFERENCES `formats`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "format_versions_parts_json_check" CHECK(json_valid("format_versions"."parts_json"))
);
--> statement-breakpoint
CREATE TABLE `formats` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'fun' NOT NULL,
	`k_points` real,
	`merged_into` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`merged_into`) REFERENCES `formats`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "formats_status_check" CHECK("formats"."status" IN ('relevant', 'fun')),
	CONSTRAINT "formats_k_points_check" CHECK("formats"."k_points" IS NULL OR "formats"."k_points" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `formats_slug_unique` ON `formats` (`slug`);--> statement-breakpoint
CREATE TABLE `oauth_accounts` (
	`provider` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`provider`, `provider_user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `oauth_accounts_user_idx` ON `oauth_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `proposal_responses` (
	`proposal_id` text NOT NULL,
	`user_id` text NOT NULL,
	`decision` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`proposal_id`, `user_id`),
	FOREIGN KEY (`proposal_id`) REFERENCES `battle_proposals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "proposal_responses_decision_check" CHECK("proposal_responses"."decision" IN ('accept', 'reject'))
);
--> statement-breakpoint
CREATE TABLE `rating_estimates` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`estimator_id` text NOT NULL,
	`format_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` real NOT NULL,
	`created_at` integer NOT NULL,
	`withdrawn_at` integer,
	FOREIGN KEY (`subject_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`estimator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`format_id`) REFERENCES `formats`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rating_estimates_kind_check" CHECK("rating_estimates"."kind" IN ('admin', 'federation', 'athlete'))
);
--> statement-breakpoint
CREATE INDEX `rating_estimates_subject_idx` ON `rating_estimates` (`subject_id`,`format_id`);--> statement-breakpoint
CREATE TABLE `rating_history` (
	`battle_id` text NOT NULL,
	`user_id` text NOT NULL,
	`format_id` text NOT NULL,
	`event_at` integer NOT NULL,
	`r_before` real NOT NULL,
	`rd_before` real NOT NULL,
	`r_after` real NOT NULL,
	`rd_after` real NOT NULL,
	`sigma_after` real NOT NULL,
	PRIMARY KEY(`battle_id`, `user_id`),
	FOREIGN KEY (`battle_id`) REFERENCES `battles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`format_id`) REFERENCES `formats`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rating_history_user_idx` ON `rating_history` (`user_id`,`format_id`,`event_at`);--> statement-breakpoint
CREATE TABLE `rating_states` (
	`format_id` text NOT NULL,
	`user_id` text NOT NULL,
	`r` real NOT NULL,
	`rd` real NOT NULL,
	`sigma` real NOT NULL,
	`last_event_at` integer,
	`n_battles` integer NOT NULL,
	`ruleset_version` integer NOT NULL,
	`computed_at` integer NOT NULL,
	PRIMARY KEY(`format_id`, `user_id`),
	FOREIGN KEY (`format_id`) REFERENCES `formats`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ruleset_version`) REFERENCES `rulesets`(`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `replay_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`format_id` text,
	`from_event_at` integer,
	`reason` text NOT NULL,
	`requested_by` text,
	`created_at` integer NOT NULL,
	`done_at` integer,
	FOREIGN KEY (`format_id`) REFERENCES `formats`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `replay_requests_open_idx` ON `replay_requests` (`done_at`);--> statement-breakpoint
CREATE TABLE `review_votes` (
	`battle_id` text NOT NULL,
	`voter_id` text NOT NULL,
	`review_level` integer NOT NULL,
	`value` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`battle_id`, `voter_id`, `review_level`),
	FOREIGN KEY (`battle_id`) REFERENCES `battles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_votes_level_check" CHECK("review_votes"."review_level" BETWEEN 1 AND 3),
	CONSTRAINT "review_votes_value_check" CHECK("review_votes"."value" BETWEEN -2 AND 2)
);
--> statement-breakpoint
CREATE TABLE `rulesets` (
	`version` integer PRIMARY KEY NOT NULL,
	`params_json` text NOT NULL,
	`valid_from` integer NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rulesets_params_json_check" CHECK(json_valid("rulesets"."params_json"))
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`battle_id` text NOT NULL,
	`user_id` text NOT NULL,
	`part_index` integer NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`video_id` text NOT NULL,
	`submitted_at` integer NOT NULL,
	PRIMARY KEY(`battle_id`, `user_id`, `part_index`, `round`),
	FOREIGN KEY (`battle_id`) REFERENCES `battles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_video_id_unique` ON `submissions` (`video_id`);--> statement-breakpoint
CREATE TABLE `user_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`granted_by` text,
	`granted_at` integer NOT NULL,
	`revoked_by` text,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_roles_role_check" CHECK("user_roles"."role" IN ('athlete', 'judge', 'organizer', 'federation', 'admin'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_roles_active_unique` ON `user_roles` (`user_id`,`role`) WHERE "user_roles"."revoked_at" IS NULL;--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`password_hash` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`age_confirmed_at` integer,
	`minor_consent_note` text,
	`approved_by` text,
	`approved_at` integer,
	`questionnaire_json` text,
	`athlete_code` text,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "users_status_check" CHECK("users"."status" IN ('pending', 'active', 'suspended', 'deleted')),
	CONSTRAINT "users_questionnaire_json_check" CHECK("users"."questionnaire_json" IS NULL OR json_valid("users"."questionnaire_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX `users_athlete_code_unique` ON `users` (`athlete_code`);--> statement-breakpoint
CREATE INDEX `users_approved_by_idx` ON `users` (`approved_by`);--> statement-breakpoint
CREATE TABLE `video_files` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`kind` text NOT NULL,
	`clip_index` integer,
	`backend` text NOT NULL,
	`locator` text NOT NULL,
	`size_bytes` integer,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "video_files_kind_check" CHECK("video_files"."kind" IN ('original', 'compressed', 'clip', 'thumbnail')),
	CONSTRAINT "video_files_backend_check" CHECK("video_files"."backend" IN ('r2', 'telegram', 'disk'))
);
--> statement-breakpoint
CREATE INDEX `video_files_video_idx` ON `video_files` (`video_id`);--> statement-breakpoint
CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`battle_id` text,
	`part_index` integer NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`retention` text DEFAULT 'delete_after_battle' NOT NULL,
	`quality` text DEFAULT 'normal' NOT NULL,
	`duration_ms` integer,
	`trim_start_ms` integer,
	`trim_end_ms` integer,
	`status` text DEFAULT 'pending_upload' NOT NULL,
	`recorded_at` integer NOT NULL,
	`uploaded_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`battle_id`) REFERENCES `battles`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "videos_visibility_check" CHECK("videos"."visibility" IN ('public', 'logged_in', 'review_only')),
	CONSTRAINT "videos_retention_check" CHECK("videos"."retention" IN ('delete_after_battle', 'keep')),
	CONSTRAINT "videos_quality_check" CHECK("videos"."quality" IN ('saver', 'normal', 'hd')),
	CONSTRAINT "videos_status_check" CHECK("videos"."status" IN ('pending_upload', 'uploaded', 'processing', 'ready', 'deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `videos_attempt_id_unique` ON `videos` (`attempt_id`);--> statement-breakpoint
CREATE INDEX `videos_battle_idx` ON `videos` (`battle_id`);--> statement-breakpoint
CREATE INDEX `videos_owner_idx` ON `videos` (`owner_id`);--> statement-breakpoint
CREATE INDEX `videos_status_idx` ON `videos` (`status`);