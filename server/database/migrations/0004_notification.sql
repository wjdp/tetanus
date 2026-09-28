CREATE TABLE `Notification` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`channel` text NOT NULL,
	`rule` text NOT NULL,
	`dedupeKey` text NOT NULL,
	`subject` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`ok` integer NOT NULL,
	`error` text,
	`diaryEntryId` integer,
	FOREIGN KEY (`diaryEntryId`) REFERENCES `DiaryEntry`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `Notification_dedupeKey_idx` ON `Notification` (`dedupeKey`);--> statement-breakpoint
CREATE INDEX `Notification_at_idx` ON `Notification` (`at`);--> statement-breakpoint
UPDATE `Setting` SET `config` = json_set(`config`, '$.alertCursor', (SELECT coalesce(max(`id`), 0) FROM `DiaryEntry`)) WHERE json_extract(`config`, '$.alertCursor') IS NULL;
