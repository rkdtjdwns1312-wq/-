-- Only the migration creates the singleton. Endpoint reads/writes fail closed
-- until this migration has been applied; existing financial data is never reset.
CREATE TABLE IF NOT EXISTS ledger_state (
  id INTEGER PRIMARY KEY CHECK (id=1),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  version INTEGER NOT NULL DEFAULT 0 CHECK (typeof(version)='integer' AND version>=0),
  updated_at TEXT
);
INSERT OR IGNORE INTO ledger_state(id,payload,version,updated_at)
VALUES(1,'{"openingBalance":0,"entries":[]}',0,NULL);

-- Full before/after API snapshots and the canonical request allow durable
-- operation deduplication, including retries after intervening edits/deletions.
-- No passwords, editor keys, cookies or other authentication data are stored.
CREATE TABLE IF NOT EXISTS ledger_revisions (
  operation TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL UNIQUE CHECK (typeof(version)='integer' AND version>0),
  request_payload TEXT NOT NULL CHECK (json_valid(request_payload)),
  previous_snapshot TEXT NOT NULL CHECK (json_valid(previous_snapshot)),
  new_snapshot TEXT NOT NULL CHECK (json_valid(new_snapshot)),
  created_at TEXT NOT NULL
);
