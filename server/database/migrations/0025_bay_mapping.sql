CREATE TABLE `Bay` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hostId` integer NOT NULL,
	`locationKey` text NOT NULL,
	`label` text NOT NULL,
	FOREIGN KEY (`hostId`) REFERENCES `Host`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Bay_hostId_locationKey_key` ON `Bay` (`hostId`,`locationKey`);--> statement-breakpoint
CREATE TABLE `Enclosure` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hostId` integer NOT NULL,
	`enclosureId` text NOT NULL,
	`name` text NOT NULL,
	`vendor` text,
	`model` text,
	`slots` text DEFAULT '[]' NOT NULL,
	`lastSeenAt` integer NOT NULL,
	FOREIGN KEY (`hostId`) REFERENCES `Host`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Enclosure_hostId_enclosureId_key` ON `Enclosure` (`hostId`,`enclosureId`);--> statement-breakpoint
ALTER TABLE `Disk` ADD `lastIdPath` text;--> statement-breakpoint
ALTER TABLE `Disk` ADD `lastSlot` text;--> statement-breakpoint
ALTER TABLE `Disk` ADD `lastLocationKey` text;