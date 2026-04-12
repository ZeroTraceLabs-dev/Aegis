/*
  # Create Scam Address Database

  1. New Tables
    - `scam_addresses`
      - `address` (text, primary key) -- Solana address flagged as scam
      - `label` (text) -- Name/description of the scam
      - `category` (text) -- drainer, phishing, rugpull, spam, other
      - `severity` (text) -- critical, high, medium, low
      - `source` (text) -- community, curated, external
      - `reported_by` (text, nullable) -- wallet address of reporter
      - `report_count` (integer) -- number of community reports
      - `verified` (boolean) -- manually verified by admin
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `scam_addresses` table
    - Anyone can read (public safety data)
    - Only authenticated users can insert reports
    - No one can update/delete via client
*/

CREATE TABLE IF NOT EXISTS scam_addresses (
  address text PRIMARY KEY,
  label text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'other',
  severity text NOT NULL DEFAULT 'medium',
  source text NOT NULL DEFAULT 'community',
  reported_by text,
  report_count integer NOT NULL DEFAULT 1,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = 'scam_addresses'
      AND rowsecurity = true
  ) THEN
    ALTER TABLE scam_addresses ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Public read access (safety data should be public)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'scam_addresses'
      AND policyname = 'Anyone can read scam addresses'
  ) THEN
    CREATE POLICY "Anyone can read scam addresses"
      ON scam_addresses
      FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;
END $$;

-- Authenticated users can report new scam addresses
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'scam_addresses'
      AND policyname = 'Authenticated users can report scam addresses'
  ) THEN
    CREATE POLICY "Authenticated users can report scam addresses"
      ON scam_addresses
      FOR INSERT
      TO authenticated
      WITH CHECK (true);
  END IF;
END $$;

-- Index for fast lookups
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'scam_addresses'
      AND indexname = 'idx_scam_addresses_category'
  ) THEN
    CREATE INDEX idx_scam_addresses_category ON scam_addresses(category);
  END IF;
END $$;

-- Index for severity filtering
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'scam_addresses'
      AND indexname = 'idx_scam_addresses_severity'
  ) THEN
    CREATE INDEX idx_scam_addresses_severity ON scam_addresses(severity);
  END IF;
END $$;
