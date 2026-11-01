CREATE TABLE IF NOT EXISTS member_schedule_access_config (
  id INTEGER PRIMARY KEY CHECK (id=1),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version>=0),
  salt TEXT NOT NULL DEFAULT '',
  verifier TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
-- No default password: an authenticated operator must configure the verifier after deployment.
INSERT OR IGNORE INTO member_schedule_access_config (id) VALUES (1);

CREATE TABLE IF NOT EXISTS member_schedule_login_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 6),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS member_schedule_login_limits_expiry ON member_schedule_login_limits(expires_at);
