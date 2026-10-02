ALTER TABLE `Pool` ADD `archivedAt` integer;--> statement-breakpoint
ALTER TABLE `Pool` ADD `archiveNote` text DEFAULT '' NOT NULL;