CREATE TABLE `Simulation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scenario` text NOT NULL,
	`subjectType` text NOT NULL,
	`subjectId` integer NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `SimulationChange` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tableName` text NOT NULL,
	`op` text NOT NULL,
	`rowId` integer NOT NULL,
	`before` text,
	`after` text
);
