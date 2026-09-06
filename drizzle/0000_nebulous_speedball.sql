CREATE TABLE `certificates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`round_id` text NOT NULL,
	`referee_number` integer NOT NULL,
	`display_name` text NOT NULL,
	`display_name_search` text NOT NULL,
	`country_code` text,
	`ruleset_version` text NOT NULL,
	`policy_version` text NOT NULL,
	`verification_code` text NOT NULL,
	`issued_at` integer NOT NULL,
	`revoked_at` integer,
	`revocation_reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `referee_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`round_id`) REFERENCES `certification_rounds`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`referee_number`) REFERENCES `referee_profiles`(`referee_number`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `certificates_round_id_unique` ON `certificates` (`round_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `certificates_verification_code_unique` ON `certificates` (`verification_code`);--> statement-breakpoint
CREATE INDEX `certificate_user_idx` ON `certificates` (`user_id`,`issued_at`);--> statement-breakpoint
CREATE INDEX `certificate_public_name_idx` ON `certificates` (`display_name_search`);--> statement-breakpoint
CREATE INDEX `certificate_public_number_idx` ON `certificates` (`referee_number`);--> statement-breakpoint
CREATE TABLE `certification_case_steps` (
	`round_id` text NOT NULL,
	`question_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`answer_key` text NOT NULL,
	`correct` integer NOT NULL,
	`assisted` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`round_id`, `question_id`, `step_index`),
	FOREIGN KEY (`round_id`) REFERENCES `certification_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cert_case_step_index_valid" CHECK("certification_case_steps"."step_index" >= 0),
	CONSTRAINT "cert_case_correct_boolean" CHECK("certification_case_steps"."correct" IN (0, 1)),
	CONSTRAINT "cert_case_assisted_boolean" CHECK("certification_case_steps"."assisted" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `certification_case_step_round_idx` ON `certification_case_steps` (`round_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `certification_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ruleset_version` text NOT NULL,
	`policy_version` text NOT NULL,
	`round_number` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `referee_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "certification_round_status_valid" CHECK("certification_rounds"."status" IN ('active', 'restarted', 'certified', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `certification_round_user_idx` ON `certification_rounds` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_certification_round_per_user` ON `certification_rounds` (`user_id`) WHERE "certification_rounds"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `certification_round_number_unique` ON `certification_rounds` (`user_id`,`round_number`);--> statement-breakpoint
CREATE TABLE `certification_rule_progress` (
	`round_id` text NOT NULL,
	`question_id` text NOT NULL,
	`first_answer_key` text NOT NULL,
	`first_correct` integer NOT NULL,
	`first_assisted` integer NOT NULL,
	`completed` integer NOT NULL,
	`captured_steps` integer DEFAULT 1 NOT NULL,
	`answer_count` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`round_id`, `question_id`),
	FOREIGN KEY (`round_id`) REFERENCES `certification_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cert_rule_first_correct_boolean" CHECK("certification_rule_progress"."first_correct" IN (0, 1)),
	CONSTRAINT "cert_rule_first_assisted_boolean" CHECK("certification_rule_progress"."first_assisted" IN (0, 1)),
	CONSTRAINT "cert_rule_completed_boolean" CHECK("certification_rule_progress"."completed" IN (0, 1)),
	CONSTRAINT "cert_rule_captured_steps_valid" CHECK("certification_rule_progress"."captured_steps" >= 1)
);
--> statement-breakpoint
CREATE INDEX `certification_rule_round_idx` ON `certification_rule_progress` (`round_id`);--> statement-breakpoint
CREATE TABLE `game_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`round_id` text,
	`purpose` text NOT NULL,
	`mode` text NOT NULL,
	`attempt_no` integer,
	`seed` integer NOT NULL,
	`duration_seconds` integer NOT NULL,
	`policy_version` text NOT NULL,
	`engine_version` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`elapsed_seconds` integer,
	`correct` integer,
	`wrong` integer,
	`missed` integer,
	`assisted` integer,
	`assessed` integer,
	`accuracy` integer,
	`qualifying` integer,
	`transcript_json` text,
	FOREIGN KEY (`user_id`) REFERENCES `referee_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`round_id`) REFERENCES `certification_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "game_attempt_purpose_valid" CHECK("game_attempts"."purpose" IN ('practice', 'certification')),
	CONSTRAINT "game_attempt_mode_valid" CHECK("game_attempts"."mode" IN ('step', 'continuous')),
	CONSTRAINT "game_attempt_status_valid" CHECK("game_attempts"."status" IN ('active', 'completed', 'abandoned')),
	CONSTRAINT "game_attempt_qualifying_boolean" CHECK("game_attempts"."qualifying" IS NULL OR "game_attempts"."qualifying" IN (0, 1)),
	CONSTRAINT "game_attempt_round_binding_valid" CHECK(("game_attempts"."purpose" = 'practice' AND "game_attempts"."round_id" IS NULL AND "game_attempts"."attempt_no" IS NULL)
          OR ("game_attempts"."purpose" = 'certification' AND "game_attempts"."round_id" IS NOT NULL AND "game_attempts"."attempt_no" > 0)),
	CONSTRAINT "game_attempt_duration_valid" CHECK("game_attempts"."duration_seconds" BETWEEN 60 AND 3600)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `certification_attempt_number_unique` ON `game_attempts` (`round_id`,`mode`,`attempt_no`);--> statement-breakpoint
CREATE INDEX `game_attempt_user_idx` ON `game_attempts` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `game_attempt_round_idx` ON `game_attempts` (`round_id`,`mode`);--> statement-breakpoint
CREATE TABLE `practice_rule_progress` (
	`user_id` text NOT NULL,
	`question_id` text NOT NULL,
	`first_answer_key` text NOT NULL,
	`first_correct` integer NOT NULL,
	`first_assisted` integer NOT NULL,
	`completed` integer NOT NULL,
	`answer_count` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `question_id`),
	FOREIGN KEY (`user_id`) REFERENCES `referee_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "practice_first_correct_boolean" CHECK("practice_rule_progress"."first_correct" IN (0, 1)),
	CONSTRAINT "practice_first_assisted_boolean" CHECK("practice_rule_progress"."first_assisted" IN (0, 1)),
	CONSTRAINT "practice_completed_boolean" CHECK("practice_rule_progress"."completed" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `referee_profiles` (
	`referee_number` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`display_name_search` text NOT NULL,
	`country_code` text,
	`public_listing` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "profile_public_listing_boolean" CHECK("referee_profiles"."public_listing" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referee_profiles_user_id_unique` ON `referee_profiles` (`user_id`);--> statement-breakpoint
CREATE INDEX `profile_name_search_idx` ON `referee_profiles` (`display_name_search`);