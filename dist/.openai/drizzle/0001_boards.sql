CREATE TABLE board_posts (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('schedule','notice')),
  payload TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_operation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_board_posts_kind_created ON board_posts(kind, created_at DESC, id);
