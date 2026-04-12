/*
  # Fix monitored_wallets table for background monitoring

  1. Schema Changes
    - Add unique constraint on (user_id, wallet_address) so upserts work
    - Add `alert_on_any_outflow` boolean column (used by tracking service)
    - Rename mismatched columns via new alias columns for backward compat
  
  2. Why This Is Needed
    - The frontend walletTrackingService uses `onConflict: 'user_id,wallet_address'`
      but no unique constraint existed, causing silent upsert failures
    - Column names in the service didn't match DB columns, causing inserts to fail
    - Result: monitored_wallets was always empty, no background monitoring
  
  3. Security
    - No RLS changes (already enabled)
*/

-- Add unique constraint on (user_id, wallet_address) for upsert support
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'monitored_wallets'
      AND indexname = 'monitored_wallets_user_wallet_unique'
  ) THEN
    CREATE UNIQUE INDEX monitored_wallets_user_wallet_unique 
    ON monitored_wallets(user_id, wallet_address);
  END IF;
END $$;

-- Add alert_on_any_outflow column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'monitored_wallets'
      AND column_name = 'alert_on_any_outflow'
  ) THEN
    ALTER TABLE monitored_wallets ADD COLUMN alert_on_any_outflow boolean DEFAULT false;
  END IF;
END $$;
