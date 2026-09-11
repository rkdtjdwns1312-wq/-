CREATE TABLE IF NOT EXISTS ranking_members (
  member_id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  points INTEGER NOT NULL,
  seed TEXT NOT NULL,
  rank INTEGER NOT NULL,
  previous_rank INTEGER NOT NULL,
  attendance INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ranking_settlements (
  schedule_id TEXT PRIMARY KEY NOT NULL,
  settled_at TEXT NOT NULL,
  operation TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS ranking_events (
  schedule_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  attendance_points INTEGER NOT NULL,
  win_points INTEGER NOT NULL,
  loss_points INTEGER NOT NULL,
  total_points INTEGER NOT NULL,
  points_before INTEGER NOT NULL,
  points_after INTEGER NOT NULL,
  rank_before INTEGER NOT NULL,
  rank_after INTEGER NOT NULL,
  seed_before TEXT NOT NULL,
  seed_after TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(schedule_id,member_id),
  FOREIGN KEY(member_id) REFERENCES ranking_members(member_id)
);

CREATE INDEX IF NOT EXISTS idx_ranking_events_member_created
ON ranking_events(member_id,created_at DESC);
