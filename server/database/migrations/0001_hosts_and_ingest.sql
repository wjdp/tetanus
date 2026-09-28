CREATE TABLE `CollectorRun` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hostId` integer NOT NULL,
	`source` text NOT NULL,
	`device` text,
	`deviceType` text,
	`exitStatus` integer,
	`receivedAt` integer NOT NULL,
	`ok` integer NOT NULL,
	`error` text,
	`bytes` integer NOT NULL,
	`producer` text,
	FOREIGN KEY (`hostId`) REFERENCES `Host`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `CollectorRun_hostId_source_receivedAt_idx` ON `CollectorRun` (`hostId`,`source`,`receivedAt`);--> statement-breakpoint
CREATE TABLE `Host` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`displayName` text,
	`toolVersions` text DEFAULT '{}' NOT NULL,
	`healthchecksUrl` text,
	`notes` text DEFAULT '' NOT NULL,
	`firstSeenAt` integer NOT NULL,
	`lastSeenAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Host_name_unique` ON `Host` (`name`);--> statement-breakpoint
CREATE TABLE `Payload` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hostId` integer NOT NULL,
	`source` text NOT NULL,
	`device` text DEFAULT '' NOT NULL,
	`receivedAt` integer NOT NULL,
	`body` text NOT NULL,
	FOREIGN KEY (`hostId`) REFERENCES `Host`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Payload_hostId_source_device_key` ON `Payload` (`hostId`,`source`,`device`);