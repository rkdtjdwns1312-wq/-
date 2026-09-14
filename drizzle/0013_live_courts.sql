-- Only the current free-play courts are shared. No ranking/settlement history.
CREATE TABLE live_courts (
  id INTEGER PRIMARY KEY CHECK(id=1),
  payload TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
