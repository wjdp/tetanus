CREATE TABLE `FaultAcceptance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`diskId` integer NOT NULL,
	`attrId` text NOT NULL,
	`acceptedValue` integer NOT NULL,
	`acceptedAt` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`supersededAt` integer,
	`clearedAt` integer,
	FOREIGN KEY (`diskId`) REFERENCES `Disk`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `FaultAcceptance_diskId_attrId_idx` ON `FaultAcceptance` (`diskId`,`attrId`);