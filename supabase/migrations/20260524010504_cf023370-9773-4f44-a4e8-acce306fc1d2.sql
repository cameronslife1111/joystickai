SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'orby-plan-scheduler-tick';

SELECT cron.schedule(
  'orby-plan-scheduler-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://orbyai.lovable.app/api/public/plan-scheduler-tick',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnZWFrdHFleGh4ZWp0YmpoemRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMDg4NTQsImV4cCI6MjA5NDU4NDg1NH0.SYj5YoZRiQ-0XJR6PABWCrSVV0EvNltrXKrLfcI8Ue0"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);