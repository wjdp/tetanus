CREATE TABLE `Setting` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`enrolToken` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	CONSTRAINT "Setting_single_row" CHECK("Setting"."id" = 1)
);
