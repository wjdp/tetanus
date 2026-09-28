CREATE TABLE `DiaryEntry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subjectType` text NOT NULL,
	`subjectId` integer,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`eventType` text,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`data` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `DiaryEntry_subjectType_subjectId_at_idx` ON `DiaryEntry` (`subjectType`,`subjectId`,`at`);--> statement-breakpoint
CREATE INDEX `DiaryEntry_at_idx` ON `DiaryEntry` (`at`);--> statement-breakpoint
CREATE TABLE `Disk` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alias` text,
	`scrutinyUuid` text,
	`model` text,
	`modelFamily` text,
	`serial` text,
	`firmware` text,
	`capacityBytes` integer,
	`rotationRate` integer,
	`protocol` text,
	`transport` text,
	`formFactor` text,
	`firstSeenAt` integer,
	`lastSeenAt` integer,
	`lastSeenHostId` integer,
	`lastDevicePath` text,
	`lastDeviceType` text,
	`stateOverride` text,
	`lastState` text,
	`notes` text DEFAULT '' NOT NULL,
	`inventory` text DEFAULT '{}' NOT NULL,
	`latestRaw` text,
	`latestStatus` text DEFAULT 'unknown' NOT NULL,
	`latestTemp` integer,
	`latestPowerOnHours` integer,
	`latestPowerCycles` integer,
	`latestReadingAt` integer,
	FOREIGN KEY (`lastSeenHostId`) REFERENCES `Host`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Disk_alias_unique` ON `Disk` (`alias`);--> statement-breakpoint
CREATE TABLE `DiskKey` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`diskId` integer NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`diskId`) REFERENCES `Disk`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `DiskKey_kind_value_key` ON `DiskKey` (`kind`,`value`);--> statement-breakpoint
CREATE INDEX `DiskKey_diskId_idx` ON `DiskKey` (`diskId`);--> statement-breakpoint
CREATE TABLE `Pool` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hostId` integer NOT NULL,
	`guid` text NOT NULL,
	`name` text NOT NULL,
	`state` text NOT NULL,
	`status` text,
	`action` text,
	`health` text,
	`errors` integer,
	`sizeBytes` integer,
	`allocBytes` integer,
	`freeBytes` integer,
	`frag` integer,
	`cap` integer,
	`dedup` real,
	`scan` text,
	`firstSeenAt` integer NOT NULL,
	`lastSeenAt` integer NOT NULL,
	FOREIGN KEY (`hostId`) REFERENCES `Host`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Pool_guid_unique` ON `Pool` (`guid`);--> statement-breakpoint
CREATE INDEX `Pool_hostId_idx` ON `Pool` (`hostId`);--> statement-breakpoint
CREATE TABLE `PoolHistory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hostId` integer NOT NULL,
	`poolId` integer,
	`at` integer NOT NULL,
	`internal` integer NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`hostId`) REFERENCES `Host`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`poolId`) REFERENCES `Pool`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `PoolHistory_hostId_at_text_key` ON `PoolHistory` (`hostId`,`at`,`text`);--> statement-breakpoint
CREATE INDEX `PoolHistory_poolId_at_idx` ON `PoolHistory` (`poolId`,`at`);--> statement-breakpoint
CREATE TABLE `PoolReading` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`poolId` integer NOT NULL,
	`at` integer NOT NULL,
	`allocBytes` integer,
	`freeBytes` integer,
	`frag` integer,
	`cap` integer,
	`state` text NOT NULL,
	FOREIGN KEY (`poolId`) REFERENCES `Pool`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `PoolReading_poolId_at_idx` ON `PoolReading` (`poolId`,`at`);--> statement-breakpoint
CREATE TABLE `SelfTest` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`diskId` integer NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`passed` integer NOT NULL,
	`lifetimeHours` integer NOT NULL,
	`lba` integer,
	`seenAt` integer NOT NULL,
	FOREIGN KEY (`diskId`) REFERENCES `Disk`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `SelfTest_diskId_type_lifetimeHours_key` ON `SelfTest` (`diskId`,`type`,`lifetimeHours`);--> statement-breakpoint
CREATE TABLE `SmartAttribute` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`readingId` integer NOT NULL,
	`diskId` integer NOT NULL,
	`takenAt` integer NOT NULL,
	`attrId` text NOT NULL,
	`name` text NOT NULL,
	`value` integer,
	`worst` integer,
	`thresh` integer,
	`rawValue` integer,
	`rawString` text,
	`whenFailed` text,
	`transformedValue` integer NOT NULL,
	`status` text NOT NULL,
	`failureRate` real,
	`reason` text,
	FOREIGN KEY (`readingId`) REFERENCES `SmartReading`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`diskId`) REFERENCES `Disk`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `SmartAttribute_diskId_attrId_takenAt_idx` ON `SmartAttribute` (`diskId`,`attrId`,`takenAt`);--> statement-breakpoint
CREATE INDEX `SmartAttribute_readingId_idx` ON `SmartAttribute` (`readingId`);--> statement-breakpoint
CREATE TABLE `SmartReading` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`diskId` integer NOT NULL,
	`hostId` integer NOT NULL,
	`takenAt` integer NOT NULL,
	`devicePath` text NOT NULL,
	`deviceType` text,
	`smartPassed` integer,
	`exitStatus` integer,
	`temp` integer,
	`powerOnHours` integer,
	`powerCycles` integer,
	`deviceStatus` text NOT NULL,
	FOREIGN KEY (`diskId`) REFERENCES `Disk`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hostId`) REFERENCES `Host`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `SmartReading_diskId_takenAt_idx` ON `SmartReading` (`diskId`,`takenAt`);--> statement-breakpoint
CREATE TABLE `TemperatureReading` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`diskId` integer NOT NULL,
	`at` integer NOT NULL,
	`celsius` integer NOT NULL,
	FOREIGN KEY (`diskId`) REFERENCES `Disk`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `TemperatureReading_diskId_at_key` ON `TemperatureReading` (`diskId`,`at`);--> statement-breakpoint
CREATE TABLE `Vdev` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`poolId` integer NOT NULL,
	`guid` text NOT NULL,
	`parentId` integer,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`state` text NOT NULL,
	`readErrors` integer DEFAULT 0 NOT NULL,
	`writeErrors` integer DEFAULT 0 NOT NULL,
	`checksumErrors` integer DEFAULT 0 NOT NULL,
	`slowIos` integer,
	`path` text,
	`devid` text,
	`physPath` text,
	`diskId` integer,
	`allocBytes` integer,
	`sizeBytes` integer,
	`frag` integer,
	`present` integer DEFAULT true NOT NULL,
	`lastSeenAt` integer NOT NULL,
	FOREIGN KEY (`poolId`) REFERENCES `Pool`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parentId`) REFERENCES `Vdev`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`diskId`) REFERENCES `Disk`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Vdev_guid_unique` ON `Vdev` (`guid`);--> statement-breakpoint
CREATE INDEX `Vdev_poolId_idx` ON `Vdev` (`poolId`);--> statement-breakpoint
CREATE INDEX `Vdev_diskId_idx` ON `Vdev` (`diskId`);--> statement-breakpoint
CREATE TABLE `VdevReading` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vdevId` integer NOT NULL,
	`at` integer NOT NULL,
	`readErrors` integer NOT NULL,
	`writeErrors` integer NOT NULL,
	`checksumErrors` integer NOT NULL,
	`slowIos` integer,
	`state` text NOT NULL,
	FOREIGN KEY (`vdevId`) REFERENCES `Vdev`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `VdevReading_vdevId_at_idx` ON `VdevReading` (`vdevId`,`at`);--> statement-breakpoint
CREATE TABLE `ZfsEvent` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hostId` integer NOT NULL,
	`eid` integer,
	`at` integer NOT NULL,
	`class` text NOT NULL,
	`poolGuid` text,
	`vdevGuid` text,
	`payload` text NOT NULL,
	FOREIGN KEY (`hostId`) REFERENCES `Host`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ZfsEvent_hostId_eid_key` ON `ZfsEvent` (`hostId`,`eid`);--> statement-breakpoint
CREATE INDEX `ZfsEvent_hostId_at_idx` ON `ZfsEvent` (`hostId`,`at`);