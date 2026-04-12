/*
  # Add Discord User ID column for DM-based alerts

  1. Modified Tables
    - `notification_preferences`
      - Added `discord_user_id` (text, nullable) — Discord user ID for private DM alerts

  2. Notes
    - Personal alerts will be sent via Discord DM using this user ID
    - Channel alerts remain for community-wide announcements only
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notification_preferences'
      AND column_name = 'discord_user_id'
  ) THEN
    ALTER TABLE notification_preferences ADD COLUMN discord_user_id text;
  END IF;
END $$;