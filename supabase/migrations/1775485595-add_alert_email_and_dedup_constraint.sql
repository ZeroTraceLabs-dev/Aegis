/*
  # Add alert_email column and alert dedup constraint

  1. Modified Tables
    - `notification_preferences`: Added `alert_email` (text, nullable) for Web3 users who need an explicit email address for alerts
  
  2. Constraints
    - `alert_history`: Added unique constraint on (wallet_address, signature) to prevent duplicate alerts across scan cycles

  3. Notes
    - Web3 Solana auth does not populate auth.users.email, so this column provides a fallback
    - The dedup constraint prevents wallet-monitor from inserting the same alert twice if last_signature update fails
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

-- Add unique constraint for alert dedup (only where signature is not null)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'alert_history'
      AND indexname = 'idx_alert_history_wallet_signature_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_alert_history_wallet_signature_unique
      ON alert_history(wallet_address, signature)
      WHERE signature IS NOT NULL;
  END IF;
END $$;
