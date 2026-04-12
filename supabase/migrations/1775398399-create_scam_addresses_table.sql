/*
  # Create scam_addresses table

  1. New Tables
    - `scam_addresses`
      - `id` (serial, primary key)
      - `address` (text, unique) - Solana address flagged as scam
      - `label` (text) - Human-readable description
      - `category` (text) - drainer, phishing, rugpull, spam, other
      - `severity` (text) - critical, high, medium, low
      - `source` (text) - community, curated, external
      - `reported_by` (text) - wallet address of reporter
      - `report_count` (integer) - number of reports
      - `verified` (boolean) - manually verified by team
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `scam_addresses` table
    - Public SELECT for all users (read scam database)
    - Authenticated INSERT for community reporting

  3. Functions
    - `increment_scam_report` - safely increment report count
*/

-- Create table if not exists
CREATE TABLE IF NOT EXISTS scam_addresses (
  id serial PRIMARY KEY,
  address text UNIQUE NOT NULL,
  label text NOT NULL DEFAULT 'Community reported',
  category text NOT NULL DEFAULT 'other',
  severity text NOT NULL DEFAULT 'medium',
  source text NOT NULL DEFAULT 'community',
  reported_by text,
  report_count integer NOT NULL DEFAULT 1,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index on address for fast lookups
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'scam_addresses'
      AND indexname = 'idx_scam_addresses_address'
  ) THEN
    CREATE INDEX idx_scam_addresses_address ON scam_addresses(address);
  END IF;
END $$;

-- Index on category for filtered queries
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

-- Public read access (anyone can check scam database)
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

-- Authenticated users can insert reports
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