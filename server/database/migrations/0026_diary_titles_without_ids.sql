CREATE VIEW `DiskLabel` AS
  SELECT `id`, COALESCE(
    NULLIF(`alias`, ''),
    NULLIF(TRIM(COALESCE(`model`, '') || ' ' || COALESCE(`serial`, '')), ''),
    'Unidentified disk'
  ) AS `label`
  FROM `Disk`;
--> statement-breakpoint
UPDATE `DiaryEntry` SET `title` =
  substr(`title`, 1, length(`title`) - length('disk ' || json_extract(`data`, '$.diskId')))
  || COALESCE((SELECT `label` FROM `DiskLabel` WHERE `id` = json_extract(`data`, '$.diskId')), 'removed disk')
WHERE `eventType` IN ('replaced-by', 'replaces', 'replacement-cleared')
  AND `title` LIKE ('%disk ' || json_extract(`data`, '$.diskId'));
--> statement-breakpoint
UPDATE `DiaryEntry` SET `title` =
  substr(`title`, 1, length(`title`) - length('disk ' || json_extract(`data`, '$.heldByDiskId')))
  || COALESCE((SELECT `label` FROM `DiskLabel` WHERE `id` = json_extract(`data`, '$.heldByDiskId')), 'removed disk')
WHERE `eventType` = 'alias-drift'
  AND `title` LIKE ('%already held by disk ' || json_extract(`data`, '$.heldByDiskId'));
--> statement-breakpoint
UPDATE `DiaryEntry` SET `title` = 'identity conflict with ' || (
  SELECT group_concat(`label`, ', ') FROM (
    SELECT COALESCE(`DiskLabel`.`label`, 'removed disk') AS `label`
    FROM json_each(`DiaryEntry`.`data`, '$.diskIds') AS `others`
    LEFT JOIN `DiskLabel` ON `DiskLabel`.`id` = `others`.`value`
    WHERE `others`.`key` > 0
    ORDER BY `others`.`value`
  )
)
WHERE `eventType` = 'identity-conflict'
  AND `title` GLOB 'identity conflict with disk [0-9]*';
--> statement-breakpoint
UPDATE `Fault` SET `data` = json_set(`data`, '$.others', (
  SELECT group_concat(`label`, ', ') FROM (
    SELECT COALESCE(`DiskLabel`.`label`, 'removed disk') AS `label`
    FROM json_each(`Fault`.`data`, '$.diskIds') AS `others`
    LEFT JOIN `DiskLabel` ON `DiskLabel`.`id` = `others`.`value`
    WHERE `others`.`key` > 0
    ORDER BY `others`.`value`
  )
))
WHERE `kind` = 'identity-conflict'
  AND json_extract(`data`, '$.others') IS NULL;
--> statement-breakpoint
UPDATE `DiaryEntry` SET `title` = 'appeared on unknown host'
WHERE `eventType` = 'disk-appeared'
  AND `title` = 'appeared on host ' || json_extract(`data`, '$.hostId');
--> statement-breakpoint
UPDATE `DiaryEntry` SET `title` = replace(
  `title`,
  'seen on host ' || json_extract(`data`, '$.hostId') || ' while ',
  'seen on unknown host while '
)
WHERE `eventType` = 'disposed-disk-seen'
  AND `title` LIKE ('seen on host ' || json_extract(`data`, '$.hostId') || ' while %');
--> statement-breakpoint
UPDATE `DiaryEntry` SET `title` = 'moved from '
  || COALESCE((SELECT `name` FROM `Host` WHERE `id` = json_extract(`data`, '$.fromHostId')), 'unknown host')
  || ' to '
  || COALESCE((SELECT `name` FROM `Host` WHERE `id` = json_extract(`data`, '$.toHostId')), 'unknown host')
WHERE `eventType` = 'moved-host'
  AND (`title` GLOB 'moved from host [0-9]* to *' OR `title` GLOB 'moved from * to host [0-9]*');
--> statement-breakpoint
DROP VIEW `DiskLabel`;
