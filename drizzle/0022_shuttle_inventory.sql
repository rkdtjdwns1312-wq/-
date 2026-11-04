-- Request 153: durable, date-ordered shuttlecock stock movements.
-- The cumulative quantity is derived from movements and never stored separately.
CREATE TABLE IF NOT EXISTS shuttle_inventory_state (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id=1),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  version INTEGER NOT NULL DEFAULT 0 CHECK (typeof(version)='integer' AND version>=0),
  updated_at TEXT
);
INSERT OR IGNORE INTO shuttle_inventory_state(id,payload,version,updated_at)
VALUES (1,'{"entries":[]}',0,NULL);

CREATE TABLE IF NOT EXISTS shuttle_inventory_revisions (
  operation TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL UNIQUE CHECK (typeof(version)='integer' AND version>0),
  request_payload TEXT NOT NULL CHECK (json_valid(request_payload)),
  previous_snapshot TEXT NOT NULL CHECK (json_valid(previous_snapshot)),
  new_snapshot TEXT NOT NULL CHECK (json_valid(new_snapshot)),
  created_at TEXT NOT NULL
);
