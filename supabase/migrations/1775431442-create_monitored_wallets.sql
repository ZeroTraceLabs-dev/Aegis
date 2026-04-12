/*
  # Create monitored_wallets table

  1. New Tables
    - `monitored_wallets`
      - `id` (uuid, primary key)
      - `user_id` (uuid, FK to auth.users)
      - `wallet_address` (text, Solana wallet address)
      - `enabled` (boolean, whether monitoring is active)
      - `threshold_sol_outflow` (numeric, SOL outflow threshold)
      - `threshold_token_outflow_usd` (numeric, token outflow USD threshold)
      - `alert_on_delegates` (boolean)
      - `alert_on_authority` (boolean)
      - `alert_on_nft_transfer` (boolean)
      - `alert_on_large_outflow` (boolean)
      - `alert_on_any_outflow` (boolean)
      - `last_checked_at` (timestamptz, last poll time)
      - `last_checked_sig` (text, last processed tx signature)
      - `created_at`, `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `monitored_wallets`
    - Users can only read/write their own rows

  3. Notes
    - Unique constraint on (user_id, wallet_address)
    - Index on enabled for poller efficiency
*/

CREATE TABLE IF NOT EXISTS monitored_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  threshold_sol_outflow numeric NOT NULL DEFAULT 0.5,
  threshold_token_outflow_usd numeric NOT NULL DEFAULT 50,
  alert_on_delegates boolean NOT NULL DEFAULT true,
  alert_on_authority boolean NOT NULL DEFAULT true,
  alert_on_nft_transfer boolean NOT NULL DEFAULT true,
  alert_on_large_outflow boolean NOT NULL DEFAULT true,
  alert_on_any_outflow boolean NOT NULL DEFAULT false,
  last_checked_at timestamptz,
  last_checked_sig text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT monitored_wallets_user_wallet_unique UNIQUE (user_id, wallet_address)
);

-- Enable RLS
ALTER TABLE monitored_wallets ENABLE ROW LEVEL SECURITY;

-- Users can read their own rows
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'monitored_wallets'
      AND policyname = 'Users can read own monitored wallets'
  ) THEN
    CREATE POLICY "Users can read own monitored wallets"
      ON monitored_wallets
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- Users can insert their own rows
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'monitored_wallets'
      AND policyname = 'Users can insert own monitored wallets'
  ) THEN
    CREATE POLICY "Users can insert own monitored wallets"
      ON monitored_wallets
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Users can update their own rows
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'monitored_wallets'
      AND policyname = 'Users can update own monitored wallets'
  ) THEN
    CREATE POLICY "Users can update own monitored wallets"
      ON monitored_wallets
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Users can delete their own rows
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'monitored_wallets'
      AND policyname = 'Users can delete own monitored wallets'
  ) THEN
    CREATE POLICY "Users can delete own monitored wallets"
      ON monitored_wallets
      FOR DELETE
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- Service role can read all enabled wallets (for the poller)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'monitored_wallets'
      AND policyname = 'Service role can read all monitored wallets'
  ) THEN
    CREATE POLICY "Service role can read all monitored wallets"
      ON monitored_wallets
      FOR SELECT
      TO service_role
      USING (true);
  END IF;
END $$;

-- Service role can update all (for poller cursor updates)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'monitored_wallets'
      AND policyname = 'Service role can update all monitored wallets'
  ) THEN
    CREATE POLICY "Service role can update all monitored wallets"
      ON monitored_wallets
      FOR UPDATE
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Index for poller: quickly find enabled wallets
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'monitored_wallets'
      AND indexname = 'idx_monitored_wallets_enabled'
  ) THEN
    CREATE INDEX idx_monitored_wallets_enabled ON monitored_wallets(enabled) WHERE enabled = true;
  END IF;
END $$;
