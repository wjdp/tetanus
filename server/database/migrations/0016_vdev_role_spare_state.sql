ALTER TABLE `Vdev` ADD `role` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `Vdev` ADD `spareState` text;--> statement-breakpoint
UPDATE `Vdev` SET `role` = `type` WHERE `type` IN ('log', 'cache', 'special', 'dedup');
