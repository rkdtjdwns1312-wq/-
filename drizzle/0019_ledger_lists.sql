-- Independent informational lists: no automatic accounting/score changes.
-- Replay preserves existing lists and revisions. No runtime schema fallback.
CREATE TABLE IF NOT EXISTS ledger_list_state (
  kind TEXT PRIMARY KEY NOT NULL CHECK (kind IN ('prepaid','sponsors')),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  version INTEGER NOT NULL DEFAULT 0 CHECK (typeof(version)='integer' AND version>=0),
  updated_at TEXT
);
INSERT OR IGNORE INTO ledger_list_state(kind,payload,version,updated_at)
VALUES ('prepaid','{"entries":[]}',0,NULL),('sponsors','{"entries":[]}',0,NULL);

-- Canonical request and full before/after snapshots support durable retries.
-- Operations and versions are scoped to a list; no credentials are retained.
CREATE TABLE IF NOT EXISTS ledger_list_revisions (
  kind TEXT NOT NULL CHECK (kind IN ('prepaid','sponsors')),
  operation TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (typeof(version)='integer' AND version>0),
  request_payload TEXT NOT NULL CHECK (json_valid(request_payload)),
  previous_snapshot TEXT NOT NULL CHECK (json_valid(previous_snapshot)),
  new_snapshot TEXT NOT NULL CHECK (json_valid(new_snapshot)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind,operation),
  UNIQUE (kind,version)
);
