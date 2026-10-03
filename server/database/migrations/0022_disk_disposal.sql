ALTER TABLE `Disk` ADD `disposal` text;--> statement-breakpoint
ALTER TABLE `Disk` ADD `replacesDiskId` integer REFERENCES Disk(id) ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX `Disk_replacesDiskId_key` ON `Disk` (`replacesDiskId`) WHERE "Disk"."replacesDiskId" IS NOT NULL;--> statement-breakpoint
UPDATE `Disk` SET
    `disposal` = json_object(
      'kind', 'sold',
      'on', coalesce(
        (SELECT date(max(`at`) / 1000, 'unixepoch') FROM `DiaryEntry`
          WHERE `subjectType` = 'disk'
            AND `subjectId` = `Disk`.`id`
            AND `eventType` = 'override-set'
            AND json_extract(`data`, '$.to') = 'sold'),
        date('now')
      )
    ),
    `stateOverride` = NULL,
    `lastState` = NULL
  WHERE `stateOverride` = 'sold';
