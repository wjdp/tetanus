UPDATE `Snapshot` SET `guid` = NULL WHERE `guid` = '9223372036854775807';
--> statement-breakpoint
DELETE FROM `PoolHistory` WHERE `poolId` IS NULL;
