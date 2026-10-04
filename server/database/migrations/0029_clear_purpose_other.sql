UPDATE `Disk` SET `inventory` = json_remove(`inventory`, '$.purpose')
WHERE json_extract(`inventory`, '$.purpose') = 'other';
