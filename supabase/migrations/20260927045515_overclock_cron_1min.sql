/*
# Overclock: 1-minute cron schedule

## Purpose
Maximize trade turnover by scanning every minute instead of every 2 minutes.
Use cron.alter_job to change schedule since we can't UPDATE cron.job directly.
*/

SELECT cron.alter_job(job_id := 1, schedule := '* * * * *');
SELECT cron.alter_job(job_id := 2, schedule := '* * * * *');
