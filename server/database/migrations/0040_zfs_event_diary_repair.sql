DELETE FROM `DiaryEntry`
WHERE `eventType` = 'events-reset'
  AND json_extract(`data`, '$.previousMaxEid') IS NULL;
--> statement-breakpoint
DELETE FROM `DiaryEntry`
WHERE `eventType` = 'events-gap'
  AND `id` NOT IN (
    SELECT min(`id`)
    FROM `DiaryEntry`
    WHERE `eventType` = 'events-gap'
    GROUP BY
      `subjectId`,
      json_extract(`data`, '$.from'),
      json_extract(`data`, '$.to')
  );
