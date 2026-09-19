CREATE TABLE IF NOT EXISTS member_access_config (
  id INTEGER PRIMARY KEY CHECK (id=1),
  version INTEGER NOT NULL DEFAULT 0,
  salt TEXT NOT NULL DEFAULT '',
  verifier TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
INSERT OR IGNORE INTO member_access_config (id) VALUES (1);
CREATE TABLE IF NOT EXISTS member_login_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS member_login_limits_expiry ON member_login_limits(expires_at);
