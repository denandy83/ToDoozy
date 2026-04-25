-- Add the three color tokens that were never being synced from local themes:
-- fgSecondary (was being smuggled into the misnamed `surface` column),
-- fgMuted, and accentFg.
--
-- The legacy `surface` column is kept (NOT NULL) so older app versions that
-- still write it continue to work. New writes populate both `surface` and
-- `fg_secondary` with the same value.

ALTER TABLE user_themes
  ADD COLUMN IF NOT EXISTS fg_secondary text,
  ADD COLUMN IF NOT EXISTS fg_muted text,
  ADD COLUMN IF NOT EXISTS accent_fg text;

UPDATE user_themes
   SET fg_secondary = surface
 WHERE fg_secondary IS NULL AND surface IS NOT NULL;
