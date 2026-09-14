-- lovable-cron-fallback-reviewed: 4320 runs/day; chat replies are produced server-side and a dropped nudge otherwise leaves a message "thinking" forever with no backstop; mirrors the existing 10s plan-tick heartbeat.
select cron.schedule(
  'orby-chat-turn-tick',
  '20 seconds',
  $$
  SELECT net.http_post(
    url := 'https://orbyai.lovable.app/api/public/chat-turn-tick',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnZWFrdHFleGh4ZWp0YmpoemRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMDg4NTQsImV4cCI6MjA5NDU4NDg1NH0.SYj5YoZRiQ-0XJR6PABWCrSVV0EvNltrXKrLfcI8Ue0"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);