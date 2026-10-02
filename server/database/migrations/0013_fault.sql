CREATE TABLE `Fault` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`subjectType` text NOT NULL,
	`subjectId` integer NOT NULL,
	`key` text NOT NULL,
	`severity` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`openedAt` integer NOT NULL,
	`lastSeenAt` integer NOT NULL,
	`resolvedAt` integer,
	`state` text NOT NULL,
	`stateChangedAt` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Fault_kind_key_live` ON `Fault` (`kind`,`key`) WHERE "Fault"."resolvedAt" IS NULL;--> statement-breakpoint
CREATE INDEX `Fault_state_idx` ON `Fault` (`state`);--> statement-breakpoint
CREATE INDEX `Fault_subjectType_subjectId_idx` ON `Fault` (`subjectType`,`subjectId`);