/*
  # Create monitored_wallets table for background wallet tracking

  1. New Tables
    - `monitored_wallets`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `wallet_address` (text, Solana wallet address)
      - `enabled` (boolean, whether monitoring is active)
      - `threshold_sol_outflow` (numeric, SOL amount to trigger alert)
      - `threshold_token_outflow_usd` (numeric, USD value to trigger alert)
      - `alert_on_delegates` (boolean)
      - `alert_on_authority` (boolean)
      - `alert_on_nft_transfer` (boolean)
      - `alert_on_large_outflow` (boolean)
      - `alert_on_any_outflow` (boolean)
      - `last_checked_at` (timestamptz, cursor for poller)
      - `last_signature` (text, last processed tx signature)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `monitored_wallets`
    - Users can only CRUD their own rows
    - Service role has full access for the poller edge function

  3. Indexes
    - Unique constraint on (user_id, wallet_address)
    - Index on enabled for poller queries
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
  last_checked_at timestamptz DEFAULT now(),
  last_signature text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: one monitoring config per user per wallet
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'monitored_wallets_user_wallet_unique'
  ) THEN
    CREATE UNIQUE INDEX monitored_wallets_user_wallet_unique
      ON monitored_wallets(user_id, wallet_address);
  END IF;
END $$;

-- Index for poller: find all enabled wallets
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_monitored_wallets_enabled'
  ) THEN
    CREATE INDEX idx_monitored_wallets_enabled
      ON monitored_wallets(enabled) WHERE enabled = true;
  END IF;
END $$;

-- Enable RLS
ALTER TABLE monitored_wallets ENABLE ROW LEVEL SECURITY;

-- Users can read their own monitored wallets
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'monitored_wallets'
      AND policyname = 'Users can read own monitored wallets'
  ) THEN
    CREATE POLICY "Users can read own monitored wallets"
      ON monitored_wallets FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- Users can insert their own monitored wallets
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'monitored_wallets'
      AND policyname = 'Users can insert own monitored wallets'
  ) THEN
    CREATE POLICY "Users can insert own monitored wallets"
      ON monitored_wallets FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Users can update their own monitored wallets
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'monitored_wallets'
      AND policyname = 'Users can update own monitored wallets'
  ) THEN
    CREATE POLICY "Users can update own monitored wallets"
      ON monitored_wallets FOR UPDATE TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Users can delete their own monitored wallets
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'monitored_wallets'
      AND policyname = 'Users can delete own monitored wallets'
  ) THEN
    CREATE POLICY "Users can delete own monitored wallets"
      ON monitored_wallets FOR DELETE TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;
