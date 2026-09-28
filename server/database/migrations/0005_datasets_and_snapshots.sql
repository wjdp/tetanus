CREATE TABLE `Dataset` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`poolId` integer NOT NULL,
	`name` text NOT NULL,
	`parentId` integer,
	`type` text NOT NULL,
	`mountpoint` text,
	`used` integer NOT NULL,
	`referenced` integer NOT NULL,
	`available` integer NOT NULL,
	`logicalUsed` integer,
	`compressRatio` real,
	`usedBySnapshots` integer,
	`usedByDataset` integer,
	`usedByChildren` integer,
	`quota` integer,
	`refQuota` integer,
	`reservation` integer,
	`recordSize` integer,
	`compression` text,
	`encryption` text,
	`creation` integer NOT NULL,
	`present` integer DEFAULT true NOT NULL,
	`firstSeenAt` integer NOT NULL,
	`lastSeenAt` integer NOT NULL,
	`latestSnapshotAt` integer,
	`snapshotCount` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`poolId`) REFERENCES `Pool`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parentId`) REFERENCES `Dataset`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Dataset_poolId_name_key` ON `Dataset` (`poolId`,`name`);--> statement-breakpoint
CREATE INDEX `Dataset_parentId_idx` ON `Dataset` (`parentId`);--> statement-breakpoint
CREATE TABLE `DatasetReading` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`datasetId` integer NOT NULL,
	`at` integer NOT NULL,
	`used` integer NOT NULL,
	`referenced` integer,
	`available` integer,
	`usedBySnapshots` integer,
	FOREIGN KEY (`datasetId`) REFERENCES `Dataset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `DatasetReading_datasetId_at_idx` ON `DatasetReading` (`datasetId`,`at`);--> statement-breakpoint
CREATE TABLE `Snapshot` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`datasetId` integer NOT NULL,
	`name` text NOT NULL,
	`guid` text,
	`used` integer NOT NULL,
	`referenced` integer NOT NULL,
	`written` integer NOT NULL,
	`creation` integer NOT NULL,
	`lastSeenAt` integer NOT NULL,
	FOREIGN KEY (`datasetId`) REFERENCES `Dataset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Snapshot_datasetId_name_key` ON `Snapshot` (`datasetId`,`name`);--> statement-breakpoint
CREATE INDEX `Snapshot_guid_idx` ON `Snapshot` (`guid`);--> statement-breakpoint
CREATE INDEX `Snapshot_datasetId_creation_idx` ON `Snapshot` (`datasetId`,`creation`);