ALTER TABLE `Host` ADD `collectorVersion` text;--> statement-breakpoint
ALTER TABLE `Host` ADD `collectorStatus` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
UPDATE `Host` SET `collectorVersion` = (
  SELECT substr(`producer`, length('tetanus-collect/') + 1)
  FROM `CollectorRun`
  WHERE `CollectorRun`.`hostId` = `Host`.`id`
    AND `producer` GLOB 'tetanus-collect/[0-9]*.[0-9]*.[0-9]*'
  ORDER BY `CollectorRun`.`id` DESC
  LIMIT 1
);
