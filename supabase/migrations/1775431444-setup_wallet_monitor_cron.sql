/*
  # Setup wallet monitor cron job

  1. Changes
    - Creates a pg_cron job that calls the wallet-monitor edge function every 3 minutes
    - Uses pg_net to make HTTP calls from within Postgres

  2. Notes
    - The job runs every 3 minutes and checks all enabled monitored wallets
    - Uses the service_role key for authentication
    - pg_net extension must be enabled for HTTP calls
*/

-- Enable pg_net if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Drop existing job if it exists (to avoid duplicates)
SELECT cron.unschedule('wallet-monitor-poll')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'wallet-monitor-poll'
);

-- Schedule the wallet monitor to run every 3 minutes
SELECT cron.schedule(
  'wallet-monitor-poll',
  '*/3 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/wallet-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
