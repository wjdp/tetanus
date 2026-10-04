DELETE FROM `DiaryEntry` WHERE `eventType` IN ('events-gap', 'events-reset');
--> statement-breakpoint
DELETE FROM `ZfsEvent` WHERE `id` IN (
  SELECT duplicate.`id`
  FROM `ZfsEvent` AS duplicate
  JOIN `ZfsEvent` AS keeper
    ON keeper.`hostId` = duplicate.`hostId`
    AND keeper.`at` = duplicate.`at`
    AND keeper.`class` = duplicate.`class`
    AND keeper.`poolGuid` IS duplicate.`poolGuid`
    AND keeper.`vdevGuid` IS duplicate.`vdevGuid`
    AND (keeper.`eid` IS NULL, keeper.`id`) < (duplicate.`eid` IS NULL, duplicate.`id`)
  WHERE NOT EXISTS (
    SELECT 1
    FROM json_each(keeper.`payload`) AS kept
    JOIN json_each(duplicate.`payload`) AS dropped ON dropped.`key` = kept.`key`
    WHERE dropped.`value` IS NOT kept.`value`
      AND kept.`value` NOT LIKE '0x%'
      AND dropped.`value` NOT LIKE '0x%'
      AND (kept.`value` GLOB '[0-9]*' AND kept.`value` NOT GLOB '*[^0-9]*')
        = (dropped.`value` GLOB '[0-9]*' AND dropped.`value` NOT GLOB '*[^0-9]*')
  )
);
