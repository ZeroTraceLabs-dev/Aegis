/*
  # Add alert_email column and alert_history dedup constraint

  1. Modified Tables
    - `notification_preferences`: Add `alert_email` column for Web3 users who have no auth email
    - `alert_history`: Add unique constraint on (wallet_address, signature) to prevent duplicate alerts

  2. Important Notes
    - Web3 Solana auth does not populate auth.users.email
    - alert_email allows users to manually enter an email for alerts
    - Dedup constraint prevents the same transaction from generating multiple alert rows
*/

-- Add alert_email column to notification_preferences
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notification_preferences'
      AND column_name = 'alert_email'
  ) THEN
    ALTER TABLE notification_preferences ADD COLUMN alert_email text;
  END IF;
END $$;

-- Add unique index on alert_history(wallet_address, signature) for dedup
-- Use partial index since signature can be null
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'alert_history'
      AND indexname = 'idx_alert_history_wallet_sig_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_alert_history_wallet_sig_unique
      ON alert_history(wallet_address, signature)
      WHERE signature IS NOT NULL;
  END IF;
END $$;
