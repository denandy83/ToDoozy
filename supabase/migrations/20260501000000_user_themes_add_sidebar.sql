-- Add sidebar color to user_themes.
-- This is a local-only field that the app derives from bg when absent, but syncing it
-- avoids re-deriving on every device and allows users to customize it independently.

ALTER TABLE user_themes ADD COLUMN IF NOT EXISTS sidebar text;

-- Populate existing rows using the same formula as the app:
--   brightness = r + g + b; if < 384 → +12 per channel (dark), else −8 (light)
UPDATE user_themes u
SET sidebar = (
  SELECT '#'
    || lpad(to_hex(GREATEST(0, LEAST(255, r + adj))), 2, '0')
    || lpad(to_hex(GREATEST(0, LEAST(255, g + adj))), 2, '0')
    || lpad(to_hex(GREATEST(0, LEAST(255, b + adj))), 2, '0')
  FROM (
    SELECT
      ('x' || lpad(substring(u.bg FROM 2 FOR 2), 2, '0'))::bit(8)::int AS r,
      ('x' || lpad(substring(u.bg FROM 4 FOR 2), 2, '0'))::bit(8)::int AS g,
      ('x' || lpad(substring(u.bg FROM 6 FOR 2), 2, '0'))::bit(8)::int AS b,
      CASE WHEN
        ('x' || lpad(substring(u.bg FROM 2 FOR 2), 2, '0'))::bit(8)::int +
        ('x' || lpad(substring(u.bg FROM 4 FOR 2), 2, '0'))::bit(8)::int +
        ('x' || lpad(substring(u.bg FROM 6 FOR 2), 2, '0'))::bit(8)::int
        < 384 THEN 12 ELSE -8
      END AS adj
  ) t
)
WHERE u.sidebar IS NULL
  AND u.bg ~ '^#[0-9a-fA-F]{6}$';
