/*
  # Create Scam Addresses Table

  1. New Tables
    - `scam_addresses`
      - `id` (uuid, primary key)
      - `address` (text, unique, Solana address)
      - `label` (text, description of the scam)
      - `category` (text, drainer/phishing/rugpull/spam/other)
      - `severity` (text, critical/high/medium/low)
      - `source` (text, community/curated/external)
      - `reported_by` (text, reporter wallet address)
      - `report_count` (integer, number of reports)
      - `verified` (boolean, manually verified by admins)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `scam_addresses`
    - Public read access (anyone can check addresses)
    - Authenticated users can insert reports

  3. Functions
    - `increment_scam_report` to safely increment report counts
*/

-- Create table
CREATE TABLE IF NOT EXISTS scam_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address text NOT NULL,
  label text NOT NULL DEFAULT 'Reported address',
  category text NOT NULL DEFAULT 'other',
  severity text NOT NULL DEFAULT 'medium',
  source text NOT NULL DEFAULT 'community',
  reported_by text,
  report_count integer NOT NULL DEFAULT 1,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Unique constraint on address
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'scam_addresses'
      AND indexname = 'scam_addresses_address_key'
  ) THEN
    CREATE UNIQUE INDEX scam_addresses_address_key ON scam_addresses(address);
  END IF;
END $$;

-- Index for category lookups
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

-- Enable RLS
ALTER TABLE scam_addresses ENABLE ROW LEVEL SECURITY;

-- Public read access (anyone can look up scam addresses)
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

-- Anon users can insert reports (wallet-based, no auth required)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'scam_addresses'
      AND policyname = 'Anyone can report scam addresses'
  ) THEN
    CREATE POLICY "Anyone can report scam addresses"
      ON scam_addresses
      FOR INSERT
      TO anon, authenticated
      WITH CHECK (true);
  END IF;
END $$;

-- Function to increment report count
CREATE OR REPLACE FUNCTION increment_scam_report(target_address text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE scam_addresses
  SET report_count = report_count + 1,
      updated_at = now()
  WHERE address = target_address;
END;
$$;
