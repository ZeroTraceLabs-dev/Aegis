/*
  # Fix Wallet Monitor Cron Job — Hardcode Supabase URL and Key

  ## Problem
  The existing cron job uses `current_setting('app.settings.supabase_url')` and
  `current_setting('app.settings.service_role_key')` which both return NULL on
  this Supabase instance. This means the cron fires every 3 minutes but the
  HTTP request goes nowhere — wallet monitoring has been dead for hours.

  ## Fix
  Replace the cron job with hardcoded project URL and use the service role key
  via Supabase vault/secrets. Since vault may not be available, we use the
  project URL directly and call with the anon key (the edge function has
  verify_jwt: false so the anon key is sufficient for cron invocation).

  ## Changes
  1. Drop existing broken cron job
  2. Recreate with hardcoded Supabase project URL and anon key
*/

-- Remove the broken cron job
SELECT cron.unschedule('wallet-monitor-poll');

-- Recreate with hardcoded values that actually work
SELECT cron.schedule(
  'wallet-monitor-poll',
  '*/3 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kdyncvvdupsnqithumrl.supabase.co/functions/v1/wallet-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkeW5jdnZkdXBzbnFpdGh1bXJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMDMzMTQsImV4cCI6MjA5MDg3OTMxNH0.aAIQgj8cQ3qrxlab6L4SnLI4sbY3K9qvYEc3-JTJq4A'
    ),
    body := '{}'::jsonb
  );
  $$
);