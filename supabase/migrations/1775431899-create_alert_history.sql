/*
  # Create alert_history table for persisting Cerberus background alerts

  1. New Tables
    - `alert_history`
      - `id` (uuid, primary key)
      - `user_id` (uuid, FK to auth.users)
      - `wallet_address` (text)
      - `signature` (text, tx signature)
      - `category` (text)
      - `severity` (text)
      - `title` (text)
      - `description` (text)
      - `enriched_body` (text, Cerberus AI enriched content)
      - `programs` (text[])
      - `channels_sent` (text[])
      - `acknowledged` (boolean)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS
    - Users can only read/update their own alerts
    - Service role has full access for the poller

  3. Indexes
    - Index on (user_id, created_at DESC) for efficient lookups
*/

CREATE TABLE IF NOT EXISTS alert_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address text NOT NULL,
  signature text,
  category text NOT NULL DEFAULT 'other',
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  enriched_body text,
  programs text[] DEFAULT '{}',
  channels_sent text[] DEFAULT '{}',
  acknowledged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE alert_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'alert_history'
      AND policyname = 'Users can read own alerts'
  ) THEN
    CREATE POLICY "Users can read own alerts"
      ON alert_history FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'alert_history'
      AND policyname = 'Users can update own alerts'
  ) THEN
    CREATE POLICY "Users can update own alerts"
      ON alert_history FOR UPDATE TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'alert_history'
      AND policyname = 'Service role can insert alerts'
  ) THEN
    CREATE POLICY "Service role can insert alerts"
      ON alert_history FOR INSERT TO service_role
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'alert_history'
      AND policyname = 'Service role can read all alerts'
  ) THEN
    CREATE POLICY "Service role can read all alerts"
      ON alert_history FOR SELECT TO service_role
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'alert_history'
      AND indexname = 'idx_alert_history_user_created'
  ) THEN
    CREATE INDEX idx_alert_history_user_created
      ON alert_history(user_id, created_at DESC);
  END IF;
END $$;
