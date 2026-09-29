ALTER TABLE `Disk` RENAME COLUMN `transport` TO `link`;--> statement-breakpoint
ALTER TABLE `Disk` ADD `media` text;--> statement-breakpoint
ALTER TABLE `Disk` ADD `interface` text;--> statement-breakpoint
ALTER TABLE `Disk` ADD `recordingTech` text;--> statement-breakpoint
ALTER TABLE `Disk` ADD `logicalBlockSize` integer;--> statement-breakpoint
ALTER TABLE `Disk` ADD `physicalBlockSize` integer;--> statement-breakpoint
ALTER TABLE `Disk` ADD `trimSupported` integer;--> statement-breakpoint
ALTER TABLE `Disk` ADD `hardware` text;--> statement-breakpoint
ALTER TABLE `Disk` ADD `specs` text;--> statement-breakpoint
ALTER TABLE `Disk` ADD `vendor` text;