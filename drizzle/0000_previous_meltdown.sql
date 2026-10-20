CREATE TABLE `notebook_records` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`record_key` text NOT NULL,
	`payload` text NOT NULL,
	`modified_at` integer DEFAULT 0 NOT NULL,
	`modified_by` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `record_key`)
);
--> statement-breakpoint
CREATE TABLE `notebooks` (
	`user_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`write_token` text NOT NULL,
	`updated_at` integer NOT NULL
);
