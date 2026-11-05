DROP INDEX `loans_owner_user_id_idx`;--> statement-breakpoint
DROP INDEX `loans_borrower_user_id_idx`;--> statement-breakpoint
CREATE INDEX `loans_owner_loaned_idx` ON `loans` (`owner_user_id`,`loaned_at`);--> statement-breakpoint
CREATE INDEX `loans_borrower_loaned_idx` ON `loans` (`borrower_user_id`,`loaned_at`);