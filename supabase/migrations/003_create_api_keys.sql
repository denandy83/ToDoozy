-- Create api_keys table for MCP and iOS Shortcut authentication
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  key TEXT NOT NULL UNIQUE,
  name TEXT DEFAULT 'Default',
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  request_count INTEGER DEFAULT 0
);

CREATE INDEX idx_api_keys_key ON api_keys(key);
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own keys" ON api_keys
  FOR ALL USING (user_id = auth.uid());

-- Migrate existing keys from user_settings
INSERT INTO api_keys (user_id, key)
SELECT user_id, value FROM user_settings
WHERE key = 'api_key' AND value IS NOT NULL
ON CONFLICT (key) DO NOTHING;
