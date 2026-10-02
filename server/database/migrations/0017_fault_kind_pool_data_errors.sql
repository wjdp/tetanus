UPDATE `Fault` SET `kind` = 'pool-data-errors', `data` = json_set(`data`, '$.scanErrors', json_extract(`data`, '$.errors'), '$.dataErrors', 0) WHERE `kind` = 'scan-errors';--> statement-breakpoint
UPDATE `DiaryEntry` SET `data` = json_set(`data`, '$.kind', 'pool-data-errors') WHERE `eventType` IN ('fault-opened', 'fault-state-changed', 'fault-resolved') AND json_extract(`data`, '$.kind') = 'scan-errors';--> statement-breakpoint
UPDATE `Notification` SET `rule` = 'pool-data-errors' WHERE `rule` = 'scan-errors';
