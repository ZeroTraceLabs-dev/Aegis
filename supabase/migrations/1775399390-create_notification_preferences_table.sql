/*
  # Create Notification Preferences Table

  1. New Tables
    - `notification_preferences`
      - `user_id` (uuid, primary key, references auth.users)
      - `email_enabled` (boolean) - Send email alerts
      - `telegram_enabled` (boolean) - Send Telegram alerts
      - `telegram_chat_id` (text) - Telegram chat ID for bot messages
      - `discord_enabled` (boolean) - Send Discord alerts
      - `discord_webhook_url` (text) - Discord webhook URL
      - `notify_health_drops` (boolean)
      - `notify_spam_airdrops` (boolean)
      - `notify_delegate_changes` (boolean)
      - `notify_authority_changes` (boolean)
      - `notify_suspicious_activity` (boolean)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS
    - Users can only read/write their own preferences
*/

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_enabled boolean NOT NULL DEFAULT true,
  telegram_enabled boolean NOT NULL DEFAULT false,
  telegram_chat_id text,
  discord_enabled boolean NOT NULL DEFAULT false,
  discord_webhook_url text,
  notify_health_drops boolean NOT NULL DEFAULT true,
  notify_spam_airdrops boolean NOT NULL DEFAULT true,
  notify_delegate_changes boolean NOT NULL DEFAULT true,
  notify_authority_changes boolean NOT NULL DEFAULT true,
  notify_suspicious_activity boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Users can read own preferences
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notification_preferences'
      AND policyname = 'Users can read own notification preferences'
  ) THEN
    CREATE POLICY "Users can read own notification preferences"
      ON notification_preferences
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- Users can insert own preferences
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notification_preferences'
      AND policyname = 'Users can insert own notification preferences'
  ) THEN
    CREATE POLICY "Users can insert own notification preferences"
      ON notification_preferences
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Users can update own preferences
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notification_preferences'
      AND policyname = 'Users can update own notification preferences'
  ) THEN
    CREATE POLICY "Users can update own notification preferences"
      ON notification_preferences
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;