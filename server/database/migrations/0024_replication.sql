CREATE TABLE `Replication` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sourceDatasetId` integer,
	`targetDatasetId` integer NOT NULL,
	`direction` text NOT NULL,
	`manualIntervalSec` integer,
	`lastSyncAt` integer,
	`archivedAt` integer,
	`archivedNote` text DEFAULT '' NOT NULL,
	`firstSeenAt` integer NOT NULL,
	`lastSeenAt` integer NOT NULL,
	FOREIGN KEY (`sourceDatasetId`) REFERENCES `Dataset`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`targetDatasetId`) REFERENCES `Dataset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Replication_targetDatasetId_key` ON `Replication` (`targetDatasetId`);--> statement-breakpoint
CREATE INDEX `Replication_sourceDatasetId_idx` ON `Replication` (`sourceDatasetId`);--> statement-breakpoint
CREATE TABLE `ReplicationSync` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`replicationId` integer NOT NULL,
	`at` integer NOT NULL,
	`snapshotName` text,
	`guid` text,
	`snapshots` integer NOT NULL,
	FOREIGN KEY (`replicationId`) REFERENCES `Replication`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ReplicationSync_replicationId_at_key` ON `ReplicationSync` (`replicationId`,`at`);