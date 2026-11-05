CREATE TABLE `catalog_request_state` (
	`provider` text PRIMARY KEY NOT NULL,
	`lease_id` text,
	`lease_expires_at` integer DEFAULT 0 NOT NULL,
	`last_request_at` integer DEFAULT 0 NOT NULL,
	`next_request_at` integer DEFAULT 0 NOT NULL,
	`cooldown_until` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`day_start` integer DEFAULT 0 NOT NULL,
	`daily_count` integer DEFAULT 0 NOT NULL,
	`robots_text` text,
	`robots_expires_at` integer DEFAULT 0 NOT NULL
);
