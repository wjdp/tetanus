UPDATE `Vdev` SET `role` = `type`
  WHERE `type` IN ('log', 'cache')
    AND NOT EXISTS (SELECT 1 FROM `Vdev` AS `child` WHERE `child`.`parentId` = `Vdev`.`id`);--> statement-breakpoint
UPDATE `Vdev` SET `type` = CASE WHEN `path` LIKE '/dev/%' THEN 'disk' ELSE 'file' END
  WHERE `type` IN ('log', 'cache')
    AND `path` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `Vdev` AS `child` WHERE `child`.`parentId` = `Vdev`.`id`);--> statement-breakpoint
WITH RECURSIVE `classed`(`id`, `role`) AS (
  SELECT `id`, `role` FROM `Vdev` WHERE `role` NOT IN ('normal', 'spare')
  UNION
  SELECT `child`.`id`, `classed`.`role` FROM `Vdev` AS `child`
    JOIN `classed` ON `child`.`parentId` = `classed`.`id`
)
UPDATE `Vdev` SET `role` = (SELECT `role` FROM `classed` WHERE `classed`.`id` = `Vdev`.`id`)
  WHERE `role` = 'normal' AND `id` IN (SELECT `id` FROM `classed`);
